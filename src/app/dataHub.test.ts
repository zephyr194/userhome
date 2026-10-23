import { describe, expect, it, vi } from "vitest";
import type { AiConfigReport } from "../ipc/aiConfig";
import {
  countAuthorizedDirectories,
  countReadyZshFiles,
  createDataHub,
  HUB_TTL_MS,
  type HubLoaders,
} from "./dataHub";

const REPORT: AiConfigReport = { tools: [] };

function loaders(overrides: Partial<HubLoaders> = {}): HubLoaders {
  return {
    appConfig: vi.fn(async () => 3),
    zshStartup: vi.fn(async () => 2),
    authorizedDirectories: vi.fn(async () => 1),
    aiTools: vi.fn(async () => REPORT),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const APP_ERROR = { code: "INTERNAL", message: "配置目录不可读", retryable: true };

describe("data hub cache", () => {
  it("reads a source once within the TTL", async () => {
    let now = 1_000;
    const set = loaders();
    const hub = createDataHub(set, { now: () => now });
    await hub.ensure("appConfig");
    now += HUB_TTL_MS - 1;
    await hub.ensure("appConfig");
    expect(set.appConfig).toHaveBeenCalledTimes(1);
  });

  it("reads again once the TTL has passed", async () => {
    let now = 1_000;
    const set = loaders();
    const hub = createDataHub(set, { now: () => now });
    await hub.ensure("appConfig");
    now += HUB_TTL_MS;
    await hub.ensure("appConfig");
    expect(set.appConfig).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight read between concurrent callers", async () => {
    const pending = deferred<number>();
    const set = loaders({ appConfig: vi.fn(() => pending.promise) });
    const hub = createDataHub(set);
    const first = hub.ensure("appConfig");
    const second = hub.ensure("appConfig");
    expect(second).toBe(first);
    expect(set.appConfig).toHaveBeenCalledTimes(1);
    pending.resolve(7);
    await expect(first).resolves.toMatchObject({ value: 7 });
  });

  it("does not cache a failed read and retries on the next ensure", async () => {
    const set = loaders({
      appConfig: vi
        .fn<() => Promise<number>>()
        .mockRejectedValueOnce(APP_ERROR)
        .mockResolvedValueOnce(4),
    });
    const hub = createDataHub(set);
    await expect(hub.ensure("appConfig")).rejects.toMatchObject({ message: APP_ERROR.message });
    expect(hub.state("appConfig")).toMatchObject({ status: "error", error: { code: "INTERNAL" } });
    await expect(hub.ensure("appConfig")).resolves.toMatchObject({ value: 4 });
    expect(set.appConfig).toHaveBeenCalledTimes(2);
  });

  it("keeps the previous value visible while a re-read is in flight", async () => {
    const pending = deferred<number>();
    const set = loaders({ appConfig: vi.fn(() => pending.promise) });
    const hub = createDataHub(set);
    hub.publish("appConfig", 3);
    void hub.refresh("appConfig");
    expect(hub.state("appConfig")).toMatchObject({ status: "loading", previous: { value: 3 } });
    pending.resolve(5);
    await vi.waitFor(() => expect(hub.state("appConfig")).toMatchObject({ status: "ready" }));
  });
});

describe("data hub publish, invalidate, and refresh", () => {
  it("serves a published value to a later ensure without reading", async () => {
    const set = loaders();
    const hub = createDataHub(set);
    hub.publish("aiTools", REPORT);
    await expect(hub.ensure("aiTools")).resolves.toMatchObject({ value: REPORT });
    expect(set.aiTools).not.toHaveBeenCalled();
    expect(hub.state("aiTools")).toMatchObject({ status: "ready" });
  });

  it("reads again on the next ensure after an invalidate and keeps the old value visible", async () => {
    const set = loaders();
    const hub = createDataHub(set);
    await hub.ensure("zshStartup");
    hub.invalidate("zshStartup");
    expect(hub.state("zshStartup")).toMatchObject({ status: "ready", reading: { value: 2 } });
    await hub.ensure("zshStartup");
    expect(set.zshStartup).toHaveBeenCalledTimes(2);
  });

  it("re-reads a subscribed source as soon as it is invalidated", async () => {
    const set = loaders();
    const hub = createDataHub(set);
    await hub.ensure("appConfig");
    hub.subscribe("appConfig", () => undefined);
    hub.invalidate("appConfig");
    await vi.waitFor(() => expect(set.appConfig).toHaveBeenCalledTimes(2));
  });

  it("drops a read that was in flight before an invalidate", async () => {
    const stale = deferred<number>();
    const fresh = deferred<number>();
    const set = loaders({
      appConfig: vi.fn().mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise),
    });
    const hub = createDataHub(set);
    void hub.ensure("appConfig");
    hub.invalidate("appConfig");
    const second = hub.ensure("appConfig");
    expect(set.appConfig).toHaveBeenCalledTimes(2);
    stale.resolve(1);
    fresh.resolve(9);
    await expect(second).resolves.toMatchObject({ value: 9 });
    expect(hub.state("appConfig")).toMatchObject({ status: "ready", reading: { value: 9 } });
  });

  it("forces a read even when the cached value is fresh", async () => {
    const set = loaders();
    const hub = createDataHub(set);
    await hub.ensure("appConfig");
    await hub.refresh("appConfig");
    expect(set.appConfig).toHaveBeenCalledTimes(2);
  });

  it("shares a forced read that is already in flight", async () => {
    const pending = deferred<number>();
    const set = loaders({ appConfig: vi.fn(() => pending.promise) });
    const hub = createDataHub(set);
    const first = hub.refresh("appConfig");
    const second = hub.refresh("appConfig");
    expect(second).toBe(first);
    expect(set.appConfig).toHaveBeenCalledTimes(1);
    pending.resolve(1);
    await first;
  });

  it("empties every source on clear", async () => {
    const set = loaders();
    const hub = createDataHub(set);
    await hub.ensure("appConfig");
    hub.clear();
    expect(hub.state("appConfig")).toEqual({ status: "empty" });
    await hub.ensure("appConfig");
    expect(set.appConfig).toHaveBeenCalledTimes(2);
  });
});

describe("data hub concurrency and subscriptions", () => {
  it("runs at most two reads at once across sources, in request order", async () => {
    const appConfig = deferred<number>();
    const zsh = deferred<number>();
    const grants = deferred<number>();
    const set = loaders({
      appConfig: vi.fn(() => appConfig.promise),
      zshStartup: vi.fn(() => zsh.promise),
      authorizedDirectories: vi.fn(() => grants.promise),
    });
    const hub = createDataHub(set);
    void hub.ensure("appConfig");
    void hub.ensure("zshStartup");
    void hub.ensure("authorizedDirectories");
    expect(set.appConfig).toHaveBeenCalledTimes(1);
    expect(set.zshStartup).toHaveBeenCalledTimes(1);
    expect(set.authorizedDirectories).not.toHaveBeenCalled();

    appConfig.resolve(1);
    await vi.waitFor(() => expect(set.authorizedDirectories).toHaveBeenCalledTimes(1));
    grants.resolve(0);
    zsh.resolve(0);
  });

  it("notifies subscribers on each state change and stops after unsubscribe", async () => {
    const set = loaders();
    const hub = createDataHub(set);
    const listener = vi.fn();
    const unsubscribe = hub.subscribe("appConfig", listener);
    await hub.ensure("appConfig");
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(2);
    unsubscribe();
    const calls = listener.mock.calls.length;
    hub.publish("appConfig", 8);
    expect(listener).toHaveBeenCalledTimes(calls);
  });
});

describe("overview source counts", () => {
  it("counts only READY zsh startup files", () => {
    const overview = {
      files: [
        { outcome: { status: "READY" } },
        { outcome: { status: "NOT_LOCATED" } },
        { outcome: { status: "READY" } },
      ],
    } as never;
    expect(countReadyZshFiles(overview)).toBe(2);
  });

  it("counts directory grants except the Caddy work directory", () => {
    const grants = [
      { id: "1", kind: "DIRECTORY", purpose: "CONFIG_DIRECTORY", displayPath: "~/a", createdAtEpochMs: 1 },
      { id: "2", kind: "DIRECTORY", purpose: "CADDY_WORK_DIR", displayPath: "~/c", createdAtEpochMs: 1 },
      { id: "3", kind: "FILE", purpose: "CONFIG_FILE", displayPath: "~/f", createdAtEpochMs: 1 },
    ] as never;
    expect(countAuthorizedDirectories(grants)).toBe(1);
  });
});
