import type { MessageKey, TranslateFunction } from "../../i18n";
import type {
  LaunchdCalendarSlot,
  LaunchdConfigFile,
  LaunchdPlistDetails,
  LaunchdService,
} from "../../ipc/services";
import { isHomebrewLabel, isSystemService, primaryConfigFile } from "./launchdModel";
import { SERVICE_DICTIONARY } from "./serviceDictionary";

export const INJECTOR_ORDER = [
  "USERHOME",
  "HOMEBREW",
  "APP",
  "USER",
  "THIRD_PARTY",
  "SYSTEM",
] as const;
export type Injector = (typeof INJECTOR_ORDER)[number];

export const INJECTOR_TITLE_KEYS: Record<Injector, MessageKey> = {
  USERHOME: "services.group.userhome",
  HOMEBREW: "services.group.homebrew",
  APP: "services.group.app",
  USER: "services.group.user",
  THIRD_PARTY: "services.group.thirdParty",
  SYSTEM: "services.group.system",
};

export interface ServiceGroup {
  injector: Injector;
  services: LaunchdService[];
}

const HOMEBREW_PREFIX = "homebrew.mxcl.";
const USERHOME_MARK = "userhome.";
const APPLICATIONS_PROGRAM = /^(?:\/Applications|~\/Applications|\/Users\/[^/]+\/Applications)\/[^/]+\.app\//;
const APP_BUNDLE_NAME = /(?:^|\/)([^/]+)\.app\//;
const REVERSE_DOMAIN_SEGMENT = /^[A-Za-z0-9-]+$/;
const COMMON_LABEL_PREFIXES = new Set(["com", "org", "net", "io", "dev", "me", "app", "cn", "co", "edu", "gov"]);
function escapeForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const DICTIONARY_PATTERNS = [...SERVICE_DICTIONARY]
  .sort((a, b) => b.key.length - a.key.length)
  .map((entry) => ({
    purpose: entry.purpose,
    pattern: new RegExp(`(^|[^a-z0-9])${escapeForPattern(entry.key)}($|[^a-z0-9])`),
  }));

function programOf(file: LaunchdConfigFile): string | undefined {
  return file.details?.program ?? file.details?.programArguments[0];
}

function programPaths(service: LaunchdService): string[] {
  return service.configFiles.flatMap((file) => {
    const program = programOf(file);
    return program === undefined ? [] : [program];
  });
}

function isReverseDomainLabel(label: string): boolean {
  const segments = label.split(".");
  return segments.length >= 3 && segments.every((segment) => REVERSE_DOMAIN_SEGMENT.test(segment));
}

/** The app bundle a job's program lives in, by its path only. */
function appBundleOf(service: LaunchdService): string | undefined {
  for (const file of service.configFiles) {
    const program = programOf(file);
    if (program === undefined) continue;
    const inApplications = APPLICATIONS_PROGRAM.test(program);
    const globalForApp =
      (file.directory === "GLOBAL_LAUNCH_AGENTS" || file.directory === "GLOBAL_LAUNCH_DAEMONS") &&
      isReverseDomainLabel(service.label);
    if (!inApplications && !globalForApp) continue;
    const match = APP_BUNDLE_NAME.exec(program);
    if (match) return match[1];
  }
  return undefined;
}

/** The group a job is listed under, judged only from fields already loaded. */
export function injectorOf(service: LaunchdService): Injector {
  if (isSystemService(service)) return "SYSTEM";
  const { kind } = service.ownership;
  if (kind === "USERHOME_CREATED" || kind === "USERHOME_ADOPTED") return "USERHOME";
  if (isHomebrewLabel(service.label)) return "HOMEBREW";
  if (appBundleOf(service) !== undefined) return "APP";
  if (service.configFiles.some((file) => file.directory === "USER_LAUNCH_AGENTS")) return "USER";
  return "THIRD_PARTY";
}

export function programFileName(service: LaunchdService): string | undefined {
  const path = programPaths(service)[0];
  if (path === undefined) return undefined;
  return path.split("/").filter((part) => part !== "").pop();
}

export function displayNameOf(service: LaunchdService): string {
  const { label, ownership } = service;
  if (isHomebrewLabel(label)) return label.slice(HOMEBREW_PREFIX.length);
  if (ownership.kind === "USERHOME_CREATED" || ownership.kind === "USERHOME_ADOPTED") {
    const at = label.indexOf(USERHOME_MARK);
    const rest = at === -1 ? "" : label.slice(at + USERHOME_MARK.length);
    if (rest !== "") return rest;
  }
  const app = appBundleOf(service);
  if (app !== undefined) return app;
  const segments = label.split(".");
  while (segments.length > 1 && COMMON_LABEL_PREFIXES.has(segments[0])) segments.shift();
  return segments.slice(-2).join(".");
}

function dictionaryPurposeKey(service: LaunchdService) {
  const candidates = [
    service.label.toLowerCase(),
    ...programPaths(service).map((path) => (path.split("/").pop() ?? "").toLowerCase()),
  ];
  for (const { purpose, pattern } of DICTIONARY_PATTERNS) {
    if (candidates.some((candidate) => pattern.test(candidate))) return purpose;
  }
  return undefined;
}

/** Null means the purpose is not known; it is never guessed. */
export function purposeOf(service: LaunchdService, t: TranslateFunction): string | null {
  const dictionary = dictionaryPurposeKey(service);
  if (dictionary !== undefined) return t(dictionary);
  if (isHomebrewLabel(service.label)) {
    return t("services.purpose.homebrewFormula", { name: displayNameOf(service) });
  }
  const app = appBundleOf(service);
  if (app !== undefined) return t("services.purpose.appHelper", { app });
  return null;
}

export type TriggerKind =
  | "LOGIN"
  | "BOOT"
  | "KEEP_ALIVE"
  | "KEEP_CONDITIONAL"
  | "INTERVAL"
  | "CALENDAR"
  | "ON_EVENT"
  | "ON_MOUNT"
  | "MANUAL"
  | "DISABLED"
  | "UNKNOWN";

export interface ServiceTrigger {
  kinds: TriggerKind[];
  /** At most two distinct labels, then an ellipsis when more were dropped. */
  badge: string;
  sentence: string;
}

interface TriggerPart {
  kind: TriggerKind;
  badge: string;
  phrase: string;
}

const BADGE_LIMIT = 2;
const BADGE_JOINER = " · ";
const CALENDAR_LIST_LIMIT = 3;
const WEEKDAY_KEYS: readonly MessageKey[] = [
  "services.trigger.weekday.0",
  "services.trigger.weekday.1",
  "services.trigger.weekday.2",
  "services.trigger.weekday.3",
  "services.trigger.weekday.4",
  "services.trigger.weekday.5",
  "services.trigger.weekday.6",
];

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function describeCalendarSlot(slot: LaunchdCalendarSlot, t: TranslateFunction): string | undefined {
  const { minute, hour, day, weekday, month } = slot;
  if (minute === undefined || hour === undefined || month !== undefined) return undefined;
  const time = `${pad2(hour)}:${pad2(minute)}`;
  if (day !== undefined) {
    return weekday === undefined
      ? t("services.trigger.calendarMonthly", { day, time })
      : undefined;
  }
  if (weekday !== undefined) {
    return t("services.trigger.calendarWeekly", {
      weekday: t(WEEKDAY_KEYS[weekday % 7]),
      time,
    });
  }
  return t("services.trigger.calendarDaily", { time });
}

function calendarPhrase(
  slots: readonly LaunchdCalendarSlot[],
  truncated: boolean,
  t: TranslateFunction,
): string {
  const described: string[] = [];
  for (const slot of slots) {
    const phrase = describeCalendarSlot(slot, t);
    if (phrase === undefined) return t("services.trigger.calendarFallback");
    described.push(phrase);
  }
  if (truncated) return t("services.trigger.calendarTruncated", { count: slots.length });
  if (described.length > CALENDAR_LIST_LIMIT) {
    return t("services.trigger.calendarCount", { count: slots.length });
  }
  return described.join(t("services.trigger.listJoiner"));
}

function intervalPhrase(seconds: number, t: TranslateFunction): string {
  if (seconds % 3600 === 0) return t("services.trigger.intervalHours", { count: seconds / 3600 });
  if (seconds % 60 === 0) return t("services.trigger.intervalMinutes", { count: seconds / 60 });
  return t("services.trigger.intervalSeconds", { count: seconds });
}

function triggerParts(
  service: LaunchdService,
  details: LaunchdPlistDetails,
  t: TranslateFunction,
): TriggerPart[] {
  const parts: TriggerPart[] = [];
  if (details.runAtLoad === true) {
    const boot = service.domain === "SYSTEM";
    const key = boot ? "services.trigger.boot" : "services.trigger.login";
    parts.push({ kind: boot ? "BOOT" : "LOGIN", badge: t(key), phrase: t(key) });
  }
  const keepAliveMode = details.keepAlive?.mode;
  if (keepAliveMode === "ALWAYS") {
    parts.push({
      kind: "KEEP_ALIVE",
      badge: t("services.trigger.keepAliveBadge"),
      phrase: t("services.trigger.keepAlive"),
    });
  }
  if (keepAliveMode === "CONDITIONAL") {
    parts.push({
      kind: "KEEP_CONDITIONAL",
      badge: t("services.trigger.keepConditionalBadge"),
      phrase: t("services.trigger.keepConditional"),
    });
  }
  if (details.startInterval !== undefined && details.startInterval > 0) {
    parts.push({
      kind: "INTERVAL",
      badge: t("services.trigger.scheduled"),
      phrase: intervalPhrase(details.startInterval, t),
    });
  }
  if (details.startCalendar !== undefined && details.startCalendar.length > 0) {
    parts.push({
      kind: "CALENDAR",
      badge: t("services.trigger.scheduled"),
      phrase: calendarPhrase(details.startCalendar, details.startCalendarTruncated === true, t),
    });
  }
  if (
    (details.watchPathsCount ?? 0) > 0 ||
    (details.queueDirectoriesCount ?? 0) > 0 ||
    (details.socketNames?.length ?? 0) > 0
  ) {
    parts.push({
      kind: "ON_EVENT",
      badge: t("services.trigger.onDemand"),
      phrase: t("services.trigger.onEvent"),
    });
  }
  if (details.startOnMount === true) {
    parts.push({
      kind: "ON_MOUNT",
      badge: t("services.trigger.onMountBadge"),
      phrase: t("services.trigger.onMount"),
    });
  }
  if (parts.length === 0) {
    parts.push({
      kind: "MANUAL",
      badge: t("services.trigger.manualBadge"),
      phrase: t("services.trigger.manual"),
    });
  }
  if (details.disabled === true) {
    parts.push({
      kind: "DISABLED",
      badge: t("services.trigger.disabled"),
      phrase: t("services.trigger.disabled"),
    });
  }
  return parts;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** How a job starts, judged only from the plist summary already loaded. */
export function triggerOf(service: LaunchdService, t: TranslateFunction): ServiceTrigger {
  const details = primaryConfigFile(service)?.details;
  const parts: TriggerPart[] =
    details === undefined
      ? [
          {
            kind: "UNKNOWN",
            badge: t("services.trigger.unknownBadge"),
            phrase: t("services.trigger.unknown"),
          },
        ]
      : triggerParts(service, details, t);
  const badges = [...new Set(parts.map((part) => part.badge))];
  const shown = badges.slice(0, BADGE_LIMIT).join(BADGE_JOINER);
  const sentence = parts
    .map((part, index) => (index === 0 ? part.phrase : lowerFirst(part.phrase)))
    .join(t("services.trigger.joiner"));
  return {
    kinds: parts.map((part) => part.kind),
    badge: badges.length > BADGE_LIMIT ? `${shown}…` : shown,
    sentence: `${sentence}${t("services.trigger.end")}`,
  };
}

/** The reason a job is listed under its group, in one short phrase. */
export function injectorBasisOf(service: LaunchdService, t: TranslateFunction): string {
  switch (injectorOf(service)) {
    case "USERHOME":
      return service.ownership.kind === "USERHOME_ADOPTED"
        ? t("services.basis.userhomeAdopted")
        : t("services.basis.userhomeCreated");
    case "HOMEBREW":
      return t("services.basis.homebrew");
    case "APP":
      return t("services.basis.app", { app: appBundleOf(service) ?? "" });
    case "USER":
      return t("services.basis.userAgents");
    case "THIRD_PARTY":
      return t("services.basis.thirdParty");
    case "SYSTEM":
      return t("services.basis.system");
  }
}

export function groupServices(services: readonly LaunchdService[]): ServiceGroup[] {
  const buckets = new Map<Injector, LaunchdService[]>();
  for (const service of services) {
    const injector = injectorOf(service);
    const bucket = buckets.get(injector);
    if (bucket) bucket.push(service);
    else buckets.set(injector, [service]);
  }
  return INJECTOR_ORDER.flatMap((injector) => {
    const members = buckets.get(injector);
    return members ? [{ injector, services: members }] : [];
  });
}

export function systemServiceCount(services: readonly LaunchdService[]): number {
  return services.filter(isSystemService).length;
}
