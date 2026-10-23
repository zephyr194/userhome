import { describe, expect, it } from "vitest";
import type { CaddyRules, CaddySite, CaddyUpstream } from "../../ipc/caddy";
import { CADDY_EXAMPLES, REFERENCE_NOTICE } from "./caddyExamples";
import { createIdSource, rulesFromDraft, siteDraftsFromRules } from "./caddyRulesModel";

// Recognizes only the subset the rules model writes: `http://host:port { ... }`
// sites, `log`, and `reverse_proxy` with explicit upstreams. Any other line makes
// the example unparseable, so such an example must be marked as reference-only.
function parseModelSubset(text: string): CaddyRules | undefined {
  const sites: CaddySite[] = [];
  let current: CaddySite | undefined;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;
    const header = /^http:\/\/(\[[^\]]+\]|[^\s:/]+):(\d{1,5}) \{$/.exec(line);
    if (header) {
      if (current) return undefined;
      current = { enabled: true, listen: { host: header[1], port: Number(header[2]) }, upstreams: [] };
      continue;
    }
    if (line === "}") {
      if (!current || current.upstreams.length === 0) return undefined;
      sites.push(current);
      current = undefined;
      continue;
    }
    if (!current) return undefined;
    if (line === "log") {
      current.accessLog = true;
      continue;
    }
    const proxy = /^reverse_proxy (.+)$/.exec(line);
    if (!proxy) return undefined;
    const upstreams: CaddyUpstream[] = [];
    for (const target of proxy[1].split(" ")) {
      const match = /^(https?):\/\/(\[[^\]]+\]|[^\s:/]+):(\d{1,5})$/.exec(target);
      if (!match) return undefined;
      upstreams.push({ scheme: match[1] as CaddyUpstream["scheme"], host: match[2], port: Number(match[3]) });
    }
    current.upstreams.push(...upstreams);
  }
  if (current || sites.length === 0) return undefined;
  return { version: 1, sites };
}

const PLACEHOLDER_HOSTS = new Set(["localhost", "127.0.0.1"]);

describe("CADDY_EXAMPLES", () => {
  it("offers six to eight examples", () => {
    expect(CADDY_EXAMPLES.length).toBeGreaterThanOrEqual(6);
    expect(CADDY_EXAMPLES.length).toBeLessThanOrEqual(8);
  });

  it("gives every example a unique id and non-empty title, purpose and text", () => {
    const ids = CADDY_EXAMPLES.map((example) => example.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const example of CADDY_EXAMPLES) {
      expect(example.id.trim(), example.id).not.toBe("");
      expect(example.title.trim(), example.id).not.toBe("");
      expect(example.purpose.trim(), example.id).not.toBe("");
      expect(example.text.trim(), example.id).not.toBe("");
    }
  });

  it("covers the requested Caddy directives", () => {
    const text = CADDY_EXAMPLES.map((example) => example.text).join("\n");
    for (const directive of [
      "reverse_proxy",
      "file_server",
      "handle_path",
      "tls internal",
      "redir",
      "encode",
      "header",
    ]) {
      expect(text, directive).toContain(directive);
    }
  });

  it("uses only placeholder hosts and never contains secret-looking material", () => {
    for (const example of CADDY_EXAMPLES) {
      const hosts = Array.from(example.text.matchAll(/\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\b/g), (match) => match[0]);
      for (const host of hosts) {
        const allowed = PLACEHOLDER_HOSTS.has(host) || host.endsWith(".example.test");
        expect(allowed, `${example.id}: ${host}`).toBe(true);
      }
      expect(example.text, example.id).not.toMatch(
        /password|passwd|secret|token|api[_-]?key|authorization|BEGIN [A-Z ]*PRIVATE KEY/i,
      );
    }
  });

  it("marks an example as rules only when the rules model can parse it", () => {
    for (const example of CADDY_EXAMPLES) {
      const parsed = parseModelSubset(example.text);
      if (example.support === "rules") {
        expect(parsed, `${example.id} should parse`).toBeDefined();
      } else {
        expect(parsed, `${example.id} is reference-only`).toBeUndefined();
      }
    }
  });

  it("accepts each rules example through the same draft validation the editor uses", () => {
    const parseable = CADDY_EXAMPLES.filter((example) => example.support === "rules");
    expect(parseable.length).toBeGreaterThan(0);
    for (const example of parseable) {
      const parsed = parseModelSubset(example.text) as CaddyRules;
      const result = rulesFromDraft(siteDraftsFromRules(parsed, createIdSource()));
      expect(result, example.id).toEqual({ ok: true, rules: parsed });
    }
  });

  it("uses the reference notice wording shown for reference-only examples", () => {
    expect(REFERENCE_NOTICE).toBe("仅作参考，需在原始编辑中使用。");
    expect(CADDY_EXAMPLES.some((example) => example.support === "reference")).toBe(true);
  });
});
