import { describe, expect, it } from "vitest";
import {
  MAX_DRAFT_UPSTREAMS,
  createIdSource,
  mapIssuesToFields,
  feedbackForField,
  rulesFromDraft,
  type SiteDraft,
} from "./caddyRulesModel";
import {
  DIRECTIVES,
  DIRECTIVE_IDS,
  addableDirectives,
  addDirective,
  canAddDirective,
  changeRowDirective,
  directiveRows,
  isRequiredRow,
  removeDirectiveRow,
  rowDirectiveOptions,
  type DirectiveControl,
  type DirectiveRow,
} from "./caddyDirectiveCatalog";

const CERT_ID = "3f2b8c1e-6a4d-4b7e-9c2f-1a2b3c4d5e6f";
const KEY_ID = "7c9d0e1f-2a3b-4c5d-8e6f-7a8b9c0d1e2f";
const CONTROLS: readonly DirectiveControl[] = ["host", "port", "upstream", "file-pair", "switch"];

function site(overrides: Partial<SiteDraft> = {}): SiteDraft {
  return {
    key: 1,
    enabled: true,
    host: "127.0.0.1",
    port: "8080",
    upstreams: [{ key: 2, scheme: "http", host: "127.0.0.1", port: "3000" }],
    tls: null,
    accessLog: false,
    ...overrides,
  };
}

function rowOf(site: SiteDraft, id: DirectiveRow["id"]): DirectiveRow {
  const row = directiveRows(site).find((entry) => entry.id === id);
  if (row === undefined) throw new Error(`no ${id} row`);
  return row;
}

describe("directive catalog completeness", () => {
  it("defines every directive with a label, a control and a validator", () => {
    expect(DIRECTIVE_IDS).toEqual(["listen.host", "listen.port", "upstream", "tls", "accessLog"]);
    for (const id of DIRECTIVE_IDS) {
      const definition = DIRECTIVES[id];
      expect(definition.label.length, id).toBeGreaterThan(0);
      expect(definition.short.length, id).toBeGreaterThan(0);
      expect(CONTROLS, id).toContain(definition.control);
      expect(typeof definition.validate, id).toBe("function");
    }
  });

  it("gives each control kind exactly one directive", () => {
    const controls = DIRECTIVE_IDS.map((id) => DIRECTIVES[id].control);
    expect([...controls].sort()).toEqual([...CONTROLS].sort());
  });

  it("marks listen host, listen port and upstream as required, and only those", () => {
    const required = DIRECTIVE_IDS.filter((id) => DIRECTIVES[id].required);
    expect(required).toEqual(["listen.host", "listen.port", "upstream"]);
    for (const id of required) {
      expect(DIRECTIVES[id].requiredReason, id).toBeTruthy();
    }
  });

  it("allows repeats only for upstream", () => {
    expect(DIRECTIVE_IDS.filter((id) => DIRECTIVES[id].repeatable)).toEqual(["upstream"]);
  });

  it("reproduces the local error keys of rulesFromDraft when every validator runs", () => {
    const broken = site({
      port: "x",
      upstreams: [
        { key: 2, scheme: "http", host: "127.0.0.1", port: "" },
        { key: 3, scheme: "https", host: "example.test", port: "70000" },
      ],
      tls: { certificateGrantId: CERT_ID },
    });
    const fromValidators = Object.assign(
      {},
      ...DIRECTIVE_IDS.map((id) => DIRECTIVES[id].validate(broken, 0)),
    );
    const result = rulesFromDraft([broken]);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(fromValidators).toEqual(result.errors);
  });

  it("leaves host and access log to the backend or the switch, with no local message", () => {
    const bad = site({ host: "bad host!", accessLog: true });
    expect(DIRECTIVES["listen.host"].validate(bad, 0)).toEqual({});
    expect(DIRECTIVES.accessLog.validate(bad, 0)).toEqual({});
  });
});

describe("directive rows", () => {
  it("lists listen host, listen port, each upstream, then HTTPS and access log when they are set", () => {
    const full = site({
      upstreams: [
        { key: 2, scheme: "http", host: "127.0.0.1", port: "3000" },
        { key: 3, scheme: "https", host: "example.test", port: "443" },
      ],
      tls: { certificateGrantId: CERT_ID, privateKeyGrantId: KEY_ID },
      accessLog: true,
    });

    expect(directiveRows(full).map((row) => row.id)).toEqual([
      "listen.host",
      "listen.port",
      "upstream",
      "upstream",
      "tls",
      "accessLog",
    ]);
  });

  it("omits HTTPS and access log rows while they are off", () => {
    expect(directiveRows(site()).map((row) => row.id)).toEqual(["listen.host", "listen.port", "upstream"]);
  });

  it("gives every row a key that is unique within the site", () => {
    const full = site({
      upstreams: [
        { key: 2, scheme: "http", host: "127.0.0.1", port: "3000" },
        { key: 3, scheme: "http", host: "127.0.0.1", port: "3001" },
      ],
      tls: {},
      accessLog: true,
    });
    const keys = directiveRows(full).map((row) => row.rowKey);

    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("available directives", () => {
  it("offers a required row only its own directive, so it cannot be dropped", () => {
    const base = site();
    expect(rowDirectiveOptions(base, rowOf(base, "listen.host"))).toEqual(["listen.host"]);
    expect(rowDirectiveOptions(base, rowOf(base, "listen.port"))).toEqual(["listen.port"]);
  });

  it("offers the only upstream row just its own directive", () => {
    const base = site();
    expect(isRequiredRow(base, rowOf(base, "upstream"))).toBe(true);
    expect(rowDirectiveOptions(base, rowOf(base, "upstream"))).toEqual(["upstream"]);
  });

  it("does not offer HTTPS or access log in another row once they are already used", () => {
    const used = site({
      upstreams: [
        { key: 2, scheme: "http", host: "127.0.0.1", port: "3000" },
        { key: 3, scheme: "http", host: "127.0.0.1", port: "3001" },
      ],
      tls: {},
      accessLog: true,
    });
    const upstreamRow = directiveRows(used).find((row) => row.upstreamKey === 3)!;

    expect(rowDirectiveOptions(used, upstreamRow)).toEqual(["upstream"]);
  });

  it("keeps the row's own directive selectable while offering the unused ones", () => {
    const two = site({
      upstreams: [
        { key: 2, scheme: "http", host: "127.0.0.1", port: "3000" },
        { key: 3, scheme: "http", host: "127.0.0.1", port: "3001" },
      ],
    });
    const upstreamRow = directiveRows(two).find((row) => row.upstreamKey === 3)!;

    expect(rowDirectiveOptions(two, upstreamRow)).toEqual(["upstream", "tls", "accessLog"]);
    expect(rowDirectiveOptions(two, rowOf(two, "upstream"))).toEqual(["upstream", "tls", "accessLog"]);
  });

  it("lists only the unused non-repeating directives in the add group, with upstream always present", () => {
    expect(addableDirectives(site())).toEqual(["upstream", "tls", "accessLog"]);
    expect(addableDirectives(site({ tls: {}, accessLog: true }))).toEqual(["upstream"]);
  });

  it("stops adding upstreams at the limit and keeps it listed", () => {
    const full = site({
      upstreams: Array.from({ length: MAX_DRAFT_UPSTREAMS }, (_, index) => ({
        key: index + 2,
        scheme: "http" as const,
        host: "127.0.0.1",
        port: "3000",
      })),
    });

    expect(canAddDirective(full, "upstream")).toBe(false);
    expect(addableDirectives(full)).toContain("upstream");
  });
});

describe("directive changes", () => {
  it("adds HTTPS with no grants yet and access log turned on", () => {
    const ids = createIdSource();

    expect(addDirective(site(), "tls", ids).tls).toEqual({});
    expect(addDirective(site(), "accessLog", ids).accessLog).toBe(true);
  });

  it("appends a new upstream draft when one is added", () => {
    const next = addDirective(site(), "upstream", createIdSource());

    expect(next.upstreams).toHaveLength(2);
    expect(next.upstreams[1]).toMatchObject({ scheme: "http", host: "127.0.0.1", port: "" });
  });

  it("removes only the row it was given", () => {
    const two = site({
      upstreams: [
        { key: 2, scheme: "http", host: "127.0.0.1", port: "3000" },
        { key: 3, scheme: "https", host: "example.test", port: "443" },
      ],
      tls: {},
      accessLog: true,
    });

    expect(removeDirectiveRow(two, { rowKey: "upstream-2", id: "upstream", upstreamKey: 2 }).upstreams).toEqual([
      { key: 3, scheme: "https", host: "example.test", port: "443" },
    ]);
    expect(removeDirectiveRow(two, rowOf(two, "tls")).tls).toBeNull();
    expect(removeDirectiveRow(two, rowOf(two, "accessLog")).accessLog).toBe(false);
  });

  it("turns an upstream row into HTTPS by replacing it, when another upstream remains", () => {
    const two = site({
      upstreams: [
        { key: 2, scheme: "http", host: "127.0.0.1", port: "3000" },
        { key: 3, scheme: "http", host: "127.0.0.1", port: "3001" },
      ],
    });
    const next = changeRowDirective(two, { rowKey: "upstream-3", id: "upstream", upstreamKey: 3 }, "tls", createIdSource());

    expect(next.upstreams.map((upstream) => upstream.key)).toEqual([2]);
    expect(next.tls).toEqual({});
  });

  it("keeps the site unchanged when the row keeps its directive", () => {
    const base = site();
    expect(changeRowDirective(base, rowOf(base, "upstream"), "upstream", createIdSource())).toBe(base);
  });

  it("builds the same rules after a row is removed and added back as before", () => {
    const base = site({ port: "8080", tls: { certificateGrantId: CERT_ID, privateKeyGrantId: KEY_ID }, accessLog: true });
    const ids = createIdSource();
    const cycled = addDirective(removeDirectiveRow(base, rowOf(base, "accessLog")), "accessLog", ids);

    expect(rulesFromDraft([cycled])).toEqual(rulesFromDraft([base]));
  });

  it("feeds a backend upstream message to the upstream row it locates", () => {
    const mapped = mapIssuesToFields([
      {
        code: "INVALID_PORT",
        severity: "ERROR",
        site: 0,
        upstream: 1,
        field: "upstreams.port",
        message: "上游端口不合法。",
      },
    ]);

    expect(feedbackForField("site.0.upstream.1.port", mapped, {}).error).toBe("上游端口不合法。");
  });
});
