import type { MessageKey } from "../../i18n";
import { ZH_COPY, type CaddyCopy } from "./caddyCopy";

export type CaddyExampleSupport = "rules" | "reference";

export interface CaddyExample {
  id: string;
  titleKey: MessageKey;
  purposeKey: MessageKey;
  /** "rules": the site rules form can express it as written. "reference": use it only in the raw editor. */
  support: CaddyExampleSupport;
  text: string;
}

export const REFERENCE_NOTICE_KEY = "caddy.examples.referenceNotice";
export const REFERENCE_NOTICE = ZH_COPY.t(REFERENCE_NOTICE_KEY);

export function exampleTitle(example: CaddyExample, copy: CaddyCopy = ZH_COPY): string {
  return copy.t(example.titleKey);
}

export function examplePurpose(example: CaddyExample, copy: CaddyCopy = ZH_COPY): string {
  return copy.t(example.purposeKey);
}

export const CADDY_EXAMPLES: readonly CaddyExample[] = [
  {
    id: "reverse-proxy",
    titleKey: "caddy.examples.reverseProxyTitle",
    purposeKey: "caddy.examples.reverseProxyPurpose",
    support: "rules",
    text: ["http://127.0.0.1:8080 {", "\treverse_proxy http://localhost:3000", "}", ""].join("\n"),
  },
  {
    id: "file-server",
    titleKey: "caddy.examples.fileServerTitle",
    purposeKey: "caddy.examples.fileServerPurpose",
    support: "reference",
    text: ["http://127.0.0.1:8081 {", "\troot * /path/to/site", "\tfile_server", "}", ""].join("\n"),
  },
  {
    id: "multi-site",
    titleKey: "caddy.examples.multiSiteTitle",
    purposeKey: "caddy.examples.multiSitePurpose",
    support: "reference",
    text: [
      "http://app.example.test {",
      "\treverse_proxy localhost:3000",
      "}",
      "",
      "http://api.example.test {",
      "\treverse_proxy localhost:3001",
      "}",
      "",
    ].join("\n"),
  },
  {
    id: "handle-path",
    titleKey: "caddy.examples.handlePathTitle",
    purposeKey: "caddy.examples.handlePathPurpose",
    support: "reference",
    text: [
      "http://127.0.0.1:8080 {",
      "\thandle_path /api/* {",
      "\t\treverse_proxy localhost:3000",
      "\t}",
      "\thandle {",
      "\t\troot * /path/to/site",
      "\t\tfile_server",
      "\t}",
      "}",
      "",
    ].join("\n"),
  },
  {
    id: "tls-internal",
    titleKey: "caddy.examples.tlsInternalTitle",
    purposeKey: "caddy.examples.tlsInternalPurpose",
    support: "reference",
    text: ["https://localhost:8443 {", "\ttls internal", "\treverse_proxy localhost:3000", "}", ""].join("\n"),
  },
  {
    id: "redirect",
    titleKey: "caddy.examples.redirectTitle",
    purposeKey: "caddy.examples.redirectPurpose",
    support: "reference",
    text: ["http://127.0.0.1:8080 {", "\tredir /old-page /new-page 301", "}", ""].join("\n"),
  },
  {
    id: "encode",
    titleKey: "caddy.examples.encodeTitle",
    purposeKey: "caddy.examples.encodePurpose",
    support: "reference",
    text: [
      "http://127.0.0.1:8080 {",
      "\tencode zstd gzip",
      "\treverse_proxy localhost:3000",
      "}",
      "",
    ].join("\n"),
  },
  {
    id: "header",
    titleKey: "caddy.examples.headerTitle",
    purposeKey: "caddy.examples.headerPurpose",
    support: "reference",
    text: [
      "http://127.0.0.1:8080 {",
      "\theader X-Content-Type-Options nosniff",
      "\treverse_proxy localhost:3000",
      "}",
      "",
    ].join("\n"),
  },
];
