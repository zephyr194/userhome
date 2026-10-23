import type { TranslateFunction } from "../../i18n";
import type { LaunchdConfigFile, LaunchdService } from "../../ipc/services";
import { isHomebrewLabel, isSystemService } from "./launchdModel";
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
