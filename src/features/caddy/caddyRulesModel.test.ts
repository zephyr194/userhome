import { describe, expect, it } from "vitest";
import type { CaddyIssue, CaddyRules } from "../../ipc/caddy";
import {
  createIdSource,
  diffMarker,
  candidateOutcomeText,
  externalExposures,
  feedbackForField,
  issueFieldKey,
  mapIssuesToFields,
  newSiteDraft,
  parsePort,
  rulesFromDraft,
  saveGate,
  siteDraftsFromRules,
  type SiteDraft,
} from "./caddyRulesModel";

const RULES: CaddyRules = {
  version: 1,
  sites: [
    {
      enabled: true,
      listen: { host: "127.0.0.1", port: 8080 },
      upstreams: [
        { scheme: "http", host: "127.0.0.1", port: 3000 },
        { scheme: "https", host: "example.test", port: 443 },
      ],
    },
    {
      enabled: false,
      listen: { host: "::1", port: 8081 },
      upstreams: [{ scheme: "http", host: "127.0.0.1", port: 3001 }],
    },
  ],
};

function drafts(): SiteDraft[] {
  return siteDraftsFromRules(RULES, createIdSource());
}

function issue(overrides: Partial<CaddyIssue>): CaddyIssue {
  return {
    code: "INVALID_HOST",
    severity: "ERROR",
    message: "主机不合法。",
    ...overrides,
  };
}

describe("draft conversion", () => {
  it("turns saved rules into editable drafts with text ports and stable keys", () => {
    const sites = drafts();

    expect(sites.map((site) => site.port)).toEqual(["8080", "8081"]);
    expect(sites[0]?.upstreams.map((upstream) => upstream.scheme)).toEqual([
      "http",
      "https",
    ]);
    const keys = sites.flatMap((site) => [site.key, ...site.upstreams.map((u) => u.key)]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("converts a valid draft back to the structured rules it came from", () => {
    const result = rulesFromDraft(drafts());

    expect(result).toEqual({ ok: true, rules: RULES });
  });

  it("creates a new site with one loopback upstream and no port yet", () => {
    const site = newSiteDraft(createIdSource());

    expect(site).toMatchObject({
      enabled: true,
      host: "127.0.0.1",
      port: "",
      upstreams: [{ scheme: "http", host: "127.0.0.1", port: "" }],
    });
    expect(rulesFromDraft([site]).ok).toBe(false);
  });

  it("accepts only plain decimal ports in range", () => {
    expect(parsePort("0")).toBe(0);
    expect(parsePort("65535")).toBe(65535);
    expect(parsePort("08080")).toBe(8080);
    for (const text of ["", " 80", "+80", "8e3", "1.5", "65536", "-1", "0x50"]) {
      expect(parsePort(text), `port text ${JSON.stringify(text)}`).toBeUndefined();
    }
  });

  it("reports a bad listen port against that site and never builds rules", () => {
    const sites = drafts();
    sites[1] = { ...sites[1]!, port: "80a" };

    const result = rulesFromDraft(sites);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors)).toEqual(["site.1.listen.port"]);
    }
  });

  it("reports a bad upstream port against the upstream that owns it", () => {
    const sites = drafts();
    sites[0] = {
      ...sites[0]!,
      upstreams: [sites[0]!.upstreams[0]!, { ...sites[0]!.upstreams[1]!, port: "" }],
    };

    const result = rulesFromDraft(sites);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(Object.keys(result.errors)).toEqual(["site.0.upstream.1.port"]);
    }
  });
});

describe("issue to field mapping", () => {
  it("locates a site-level listen issue by site index and field", () => {
    expect(
      issueFieldKey(issue({ site: 2, field: "listen.host" })),
    ).toBe("site.2.listen.host");
    expect(
      issueFieldKey(issue({ site: 0, field: "listen.port", code: "PRIVILEGED_PORT", severity: "WARNING" })),
    ).toBe("site.0.listen.port");
  });

  it("locates an upstream issue by site and upstream index", () => {
    expect(
      issueFieldKey(issue({ site: 1, upstream: 3, field: "upstreams.port", code: "INVALID_PORT" })),
    ).toBe("site.1.upstream.3.port");
    expect(
      issueFieldKey(issue({ site: 1, upstream: 0, field: "upstreams.host" })),
    ).toBe("site.1.upstream.0.host");
  });

  it("locates a missing upstream list on the site rather than a single upstream", () => {
    expect(
      issueFieldKey(issue({ site: 0, field: "upstreams", code: "NO_UPSTREAM" })),
    ).toBe("site.0.upstreams");
  });

  it("keeps whole-rule problems out of any field", () => {
    expect(issueFieldKey(issue({ field: "sites", code: "TOO_MANY_SITES" }))).toBeUndefined();
    expect(issueFieldKey(issue({ field: "version", code: "UNSUPPORTED_VERSION" }))).toBeUndefined();
  });

  it("separates field-bound issues from general ones", () => {
    const mapped = mapIssuesToFields([
      issue({ site: 0, field: "listen.host" }),
      issue({ field: "version", code: "UNSUPPORTED_VERSION" }),
    ]);

    expect(Object.keys(mapped.byField)).toEqual(["site.0.listen.host"]);
    expect(mapped.general.map((entry) => entry.code)).toEqual(["UNSUPPORTED_VERSION"]);
  });

  it("gives a field its error and its warning separately", () => {
    const mapped = mapIssuesToFields([
      issue({ site: 0, field: "listen.port", code: "PRIVILEGED_PORT", severity: "WARNING", message: "端口小于 1024。" }),
    ]);

    expect(feedbackForField("site.0.listen.port", mapped, {})).toEqual({
      warning: "端口小于 1024。",
    });
  });

  it("prefers a local input message over a backend error on the same field", () => {
    const mapped = mapIssuesToFields([
      issue({ site: 0, field: "listen.port", code: "INVALID_PORT", message: "端口必须在 1 到 65535 之间。" }),
    ]);

    expect(
      feedbackForField("site.0.listen.port", mapped, {
        "site.0.listen.port": "端口必须是 0 到 65535 之间的整数。",
      }).error,
    ).toBe("端口必须是 0 到 65535 之间的整数。");
  });
});

describe("exposure and diff presentation", () => {
  it("lists only the exposures that are visible outside loopback", () => {
    const exposed = externalExposures([
      { site: 0, listen: "127.0.0.1:8080", visibleExternally: false, reason: "LOOPBACK" },
      { site: 1, listen: "0.0.0.0:9000", visibleExternally: true, reason: "ALL_INTERFACES" },
    ]);

    expect(exposed).toEqual([
      { site: 1, listen: "0.0.0.0:9000", visibleExternally: true, reason: "ALL_INTERFACES" },
    ]);
  });

  it("marks every diff change with a symbol and a text label, not only a color", () => {
    const markers = [
      diffMarker("ADDED"),
      diffMarker("REMOVED"),
      diffMarker("UNCHANGED"),
    ];

    expect(markers.map((marker) => marker.symbol)).toEqual(["+", "-", " "]);
    expect(markers.map((marker) => marker.label)).toEqual(["新增", "删除", "不变"]);
    for (const marker of markers) {
      expect(marker.label.length).toBeGreaterThan(0);
    }
  });

  it("describes every detection outcome with a distinct, non-empty text", () => {
    const outcomes = [
      "MISSING",
      "UNREADABLE",
      "OUTSIDE_ROOT",
      "NOT_REGULAR_FILE",
      "NOT_EXECUTABLE",
      "GROUP_OR_WORLD_WRITABLE",
      "USABLE",
    ] as const;
    const texts = outcomes.map((outcome) => candidateOutcomeText(outcome));

    expect(texts.every((text) => text.length > 0)).toBe(true);
    expect(new Set(texts).size).toBe(outcomes.length);
  });
});

describe("save gate", () => {
  const ready = {
    status: "ready" as const,
    preview: {
      valid: true,
      validation: { issues: [], conflicts: [], exposures: [] },
      generatedText: "x",
      diff: [],
      hasSavedVersion: false,
    },
  };

  it("is enabled only when the draft is valid, the preview is ready and valid, and nothing is saving", () => {
    expect(saveGate({ localValid: true, preview: ready, saving: false })).toEqual({
      enabled: true,
    });
  });

  it("is disabled with a reason while the draft has local errors", () => {
    expect(saveGate({ localValid: false, preview: ready, saving: false })).toEqual({
      enabled: false,
      reason: "请先修正表单中的错误。",
    });
  });

  it("is disabled while a preview is pending", () => {
    expect(
      saveGate({ localValid: true, preview: { status: "pending" }, saving: false }).enabled,
    ).toBe(false);
  });

  it("is disabled when the backend reports a blocking preview", () => {
    const blocked = {
      status: "ready" as const,
      preview: { ...ready.preview, valid: false },
    };

    expect(saveGate({ localValid: true, preview: blocked, saving: false })).toEqual({
      enabled: false,
      reason: "校验未通过，无法保存。",
    });
  });

  it("is disabled while a save is in flight", () => {
    expect(saveGate({ localValid: true, preview: ready, saving: true }).enabled).toBe(false);
  });

  it("is disabled when the preview itself failed", () => {
    expect(
      saveGate({
        localValid: true,
        preview: { status: "failed", error: { code: "INTERNAL", message: "x", retryable: false } },
        saving: false,
      }).enabled,
    ).toBe(false);
  });
});
