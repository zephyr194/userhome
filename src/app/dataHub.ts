import { useSyncExternalStore } from "react";
import { decodeAppError, type AppError } from "../ipc/core";
import { detectAiConfig, type AiConfigReport } from "../ipc/aiConfig";
import { listAppConfigEntries } from "../ipc/appConfig";
import { readZshStartupFiles, type ZshOverview } from "../ipc/environment";
import { listGrants, type GrantSummary } from "../ipc/grants";

export interface HubValues {
  appConfig: number;
  zshStartup: number;
  authorizedDirectories: number;
  aiTools: AiConfigReport;
}

export type HubSourceId = keyof HubValues;

export const HUB_SOURCE_IDS: readonly HubSourceId[] = [
  "appConfig",
  "zshStartup",
  "authorizedDirectories",
  "aiTools",
];

export interface Reading<T> {
  value: T;
  readAt: number;
}

export type HubState<T> =
  | { status: "empty" }
  | { status: "loading"; previous: Reading<T> | undefined }
  | { status: "ready"; reading: Reading<T> }
  | { status: "error"; error: AppError; previous: Reading<T> | undefined };

export type HubLoaders = { [K in HubSourceId]: () => Promise<HubValues[K]> };

export const HUB_TTL_MS = 5 * 60_000;
export const HUB_MAX_CONCURRENT_LOADS = 2;

interface Entry<T> {
  reading: Reading<T> | undefined;
  error: AppError | undefined;
  inFlight: Promise<Reading<T>> | undefined;
  stale: boolean;
  generation: number;
  snapshot: HubState<T>;
  listeners: Set<() => void>;
}

type Entries = { [K in HubSourceId]: Entry<HubValues[K]> };

export interface HubOptions {
  ttlMs?: number;
  maxConcurrent?: number;
  now?: () => number;
}

export interface DataHub {
  ensure<K extends HubSourceId>(id: K): Promise<Reading<HubValues[K]>>;
  refresh<K extends HubSourceId>(id: K): Promise<Reading<HubValues[K]>>;
  publish<K extends HubSourceId>(id: K, value: HubValues[K]): void;
  invalidate(id: HubSourceId): void;
  state<K extends HubSourceId>(id: K): HubState<HubValues[K]>;
  subscribe(id: HubSourceId, listener: () => void): () => void;
  clear(): void;
}

function attempt<T>(load: () => Promise<T>): Promise<T> {
  try {
    return load();
  } catch (error) {
    return Promise.reject(error);
  }
}

function newEntry<T>(): Entry<T> {
  return {
    reading: undefined,
    error: undefined,
    inFlight: undefined,
    stale: true,
    generation: 0,
    snapshot: { status: "empty" },
    listeners: new Set(),
  };
}

function snapshotOf<T>(entry: Entry<T>): HubState<T> {
  if (entry.inFlight !== undefined) return { status: "loading", previous: entry.reading };
  if (entry.error !== undefined) {
    return { status: "error", error: entry.error, previous: entry.reading };
  }
  if (entry.reading !== undefined) return { status: "ready", reading: entry.reading };
  return { status: "empty" };
}

function commit<T>(entry: Entry<T>): void {
  entry.snapshot = snapshotOf(entry);
  for (const listener of entry.listeners) listener();
}

/**
 * Shared cache for the light facts the overview shows. Each source is read at most
 * once per TTL, concurrent callers share one read, a failed read is not cached, and
 * at most `maxConcurrent` reads run at the same time across all sources.
 */
export function createDataHub(loaders: HubLoaders, options: HubOptions = {}): DataHub {
  const ttlMs = options.ttlMs ?? HUB_TTL_MS;
  const maxConcurrent = options.maxConcurrent ?? HUB_MAX_CONCURRENT_LOADS;
  const now = options.now ?? Date.now;
  const entries: Entries = {
    appConfig: newEntry(),
    zshStartup: newEntry(),
    authorizedDirectories: newEntry(),
    aiTools: newEntry(),
  };
  const queue: (() => void)[] = [];
  let active = 0;

  function pump(): void {
    while (active < maxConcurrent) {
      const next = queue.shift();
      if (next === undefined) return;
      active += 1;
      next();
    }
  }

  function start<K extends HubSourceId>(id: K): Promise<Reading<HubValues[K]>> {
    const entry = entries[id];
    const generation = entry.generation;
    const loaded = new Promise<HubValues[K]>((resolve, reject) => {
      queue.push(() => {
        attempt(loaders[id]).then(resolve, reject).finally(() => {
          active -= 1;
          pump();
        });
      });
    });
    pump();
    const request = loaded.then(
      (value) => {
        const reading: Reading<HubValues[K]> = { value, readAt: now() };
        if (entry.generation === generation) {
          entry.reading = reading;
          entry.error = undefined;
          entry.stale = false;
          entry.inFlight = undefined;
          commit(entry);
        }
        return reading;
      },
      (error: unknown) => {
        const appError = decodeAppError(error);
        if (entry.generation === generation) {
          entry.error = appError;
          entry.inFlight = undefined;
          commit(entry);
        }
        throw appError;
      },
    );
    entry.inFlight = request;
    commit(entry);
    return request;
  }

  function isFresh<T>(entry: Entry<T>): entry is Entry<T> & { reading: Reading<T> } {
    return (
      entry.reading !== undefined &&
      !entry.stale &&
      now() - entry.reading.readAt < ttlMs
    );
  }

  return {
    ensure(id) {
      const entry = entries[id];
      if (entry.inFlight !== undefined) return entry.inFlight;
      if (isFresh(entry)) return Promise.resolve(entry.reading);
      return start(id);
    },
    refresh(id) {
      return entries[id].inFlight ?? start(id);
    },
    publish(id, value) {
      const entry = entries[id];
      entry.generation += 1;
      entry.inFlight = undefined;
      entry.reading = { value, readAt: now() };
      entry.error = undefined;
      entry.stale = false;
      commit(entry);
    },
    invalidate(id) {
      const entry = entries[id];
      entry.generation += 1;
      entry.inFlight = undefined;
      entry.stale = true;
      commit<HubValues[HubSourceId]>(entry);
      if (entry.listeners.size > 0) void start(id).catch(() => undefined);
    },
    state(id) {
      return entries[id].snapshot;
    },
    subscribe(id, listener) {
      const entry = entries[id];
      entry.listeners.add(listener);
      return () => {
        entry.listeners.delete(listener);
      };
    },
    clear() {
      for (const id of HUB_SOURCE_IDS) {
        const entry = entries[id];
        entry.generation += 1;
        entry.inFlight = undefined;
        entry.reading = undefined;
        entry.error = undefined;
        entry.stale = true;
        commit<HubValues[HubSourceId]>(entry);
      }
    },
  };
}

export function countReadyZshFiles(overview: ZshOverview): number {
  return overview.files.filter((file) => file.outcome.status === "READY").length;
}

export function countAuthorizedDirectories(grants: readonly GrantSummary[]): number {
  return grants.filter(
    (grant) => grant.kind === "DIRECTORY" && grant.purpose !== "CADDY_WORK_DIR",
  ).length;
}

const defaultLoaders: HubLoaders = {
  appConfig: () => listAppConfigEntries().then((items) => items.length),
  zshStartup: () => readZshStartupFiles().then(countReadyZshFiles),
  authorizedDirectories: () => listGrants().then(countAuthorizedDirectories),
  aiTools: () => detectAiConfig(),
};

export const dataHub: DataHub = createDataHub(defaultLoaders);

export function useHubSource<K extends HubSourceId>(id: K): HubState<HubValues[K]> {
  const read = () => dataHub.state(id);
  return useSyncExternalStore(
    (listener) => dataHub.subscribe(id, listener),
    read,
    read,
  );
}
