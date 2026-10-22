import { describe, expect, it } from "vitest";
import type { CaddyIssue } from "../../ipc/caddy";
import {
  feedbackForField,
  mapIssuesToFields,
  newSiteDraft,
  rulesFromDraft,
  createIdSource,
  type SiteDraft,
} from "./caddyRulesModel";

const PORT_MESSAGE = "端口必须是 0 到 65535 之间的整数。";
const TLS_MISSING_MESSAGE = "请选择证书文件与私钥文件，或关闭 HTTPS。";
const CERT_ID = "3f2b8c1e-6a4d-4b7e-9c2f-1a2b3c4d5e6f";
const KEY_ID = "7c9d0e1f-2a3b-4c5d-8e6f-7a8b9c0d1e2f";

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

function backendIssue(overrides: Partial<CaddyIssue>): CaddyIssue {
  return { code: "INVALID_HOST", severity: "ERROR", message: "主机不合法。", ...overrides };
}

describe("golden: 单站点默认值", () => {
  it("a brand-new site with blank ports reports both ports and builds no rules", () => {
    const result = rulesFromDraft([newSiteDraft(createIdSource())]);

    expect(result).toEqual({
      ok: false,
      errors: {
        "site.0.listen.port": PORT_MESSAGE,
        "site.0.upstream.0.port": PORT_MESSAGE,
      },
    });
  });

  it("the default host and upstream host fill in as loopback with plain HTTP", () => {
    const filled = newSiteDraft(createIdSource());
    filled.port = "8080";
    filled.upstreams[0]!.port = "3000";

    expect(rulesFromDraft([filled])).toEqual({
      ok: true,
      rules: {
        version: 1,
        sites: [
          {
            enabled: true,
            listen: { host: "127.0.0.1", port: 8080 },
            upstreams: [{ scheme: "http", host: "127.0.0.1", port: 3000 }],
          },
        ],
      },
    });
  });
});

describe("golden: 两个站点", () => {
  it("keeps site order and the disabled flag per site", () => {
    const first = site({ key: 1, port: "8080" });
    const second = site({
      key: 3,
      enabled: false,
      host: "::1",
      port: "8081",
      upstreams: [{ key: 4, scheme: "http", host: "127.0.0.1", port: "3001" }],
    });

    expect(rulesFromDraft([first, second])).toEqual({
      ok: true,
      rules: {
        version: 1,
        sites: [
          {
            enabled: true,
            listen: { host: "127.0.0.1", port: 8080 },
            upstreams: [{ scheme: "http", host: "127.0.0.1", port: 3000 }],
          },
          {
            enabled: false,
            listen: { host: "::1", port: 8081 },
            upstreams: [{ scheme: "http", host: "127.0.0.1", port: 3001 }],
          },
        ],
      },
    });
  });
});

describe("golden: 单站点多上游", () => {
  it("keeps every upstream in order, including an https upstream", () => {
    const multi = site({
      upstreams: [
        { key: 2, scheme: "http", host: "127.0.0.1", port: "3000" },
        { key: 3, scheme: "https", host: "example.test", port: "443" },
      ],
    });

    expect(rulesFromDraft([multi])).toEqual({
      ok: true,
      rules: {
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
        ],
      },
    });
  });
});

describe("golden: 启用 HTTPS", () => {
  it("writes both grant ids into the rules when both files are chosen", () => {
    const secure = site({ tls: { certificateGrantId: CERT_ID, privateKeyGrantId: KEY_ID } });

    expect(rulesFromDraft([secure])).toEqual({
      ok: true,
      rules: {
        version: 1,
        sites: [
          {
            enabled: true,
            listen: { host: "127.0.0.1", port: 8080 },
            upstreams: [{ scheme: "http", host: "127.0.0.1", port: 3000 }],
            tls: { certificateGrantId: CERT_ID, privateKeyGrantId: KEY_ID },
          },
        ],
      },
    });
  });

  it("reports a half-chosen TLS pair on the site and builds no rules", () => {
    const half = site({ tls: { certificateGrantId: CERT_ID } });

    expect(rulesFromDraft([half])).toEqual({
      ok: false,
      errors: { "site.0.tls": TLS_MISSING_MESSAGE },
    });
  });

  it("reports TLS turned on with no files at all", () => {
    expect(rulesFromDraft([site({ tls: {} })])).toEqual({
      ok: false,
      errors: { "site.0.tls": TLS_MISSING_MESSAGE },
    });
  });
});

describe("golden: 访问日志", () => {
  it("adds accessLog true only when the log is on", () => {
    const on = rulesFromDraft([site({ accessLog: true })]);
    const off = rulesFromDraft([site({ accessLog: false })]);

    expect(on).toEqual({
      ok: true,
      rules: {
        version: 1,
        sites: [
          {
            enabled: true,
            listen: { host: "127.0.0.1", port: 8080 },
            upstreams: [{ scheme: "http", host: "127.0.0.1", port: 3000 }],
            accessLog: true,
          },
        ],
      },
    });
    expect(off.ok && off.rules.sites[0]).not.toHaveProperty("accessLog");
  });
});

describe("golden: 无效端口", () => {
  it("rejects an empty, non-numeric, or out-of-range listen port", () => {
    for (const port of ["", "abc", "65536"]) {
      expect(rulesFromDraft([site({ port })]), `listen port ${JSON.stringify(port)}`).toEqual({
        ok: false,
        errors: { "site.0.listen.port": PORT_MESSAGE },
      });
    }
  });

  it("rejects a bad upstream port against that upstream and keeps the listen port", () => {
    const bad = site({
      upstreams: [{ key: 2, scheme: "http", host: "127.0.0.1", port: "65536" }],
    });

    expect(rulesFromDraft([bad])).toEqual({
      ok: false,
      errors: { "site.0.upstream.0.port": PORT_MESSAGE },
    });
  });

  it("reports the listen and upstream ports together", () => {
    const bad = site({
      port: "x",
      upstreams: [{ key: 2, scheme: "http", host: "127.0.0.1", port: "" }],
    });

    expect(rulesFromDraft([bad])).toEqual({
      ok: false,
      errors: {
        "site.0.listen.port": PORT_MESSAGE,
        "site.0.upstream.0.port": PORT_MESSAGE,
      },
    });
  });
});

describe("golden: 无效主机", () => {
  it("passes an invalid host through locally for the backend to judge", () => {
    expect(rulesFromDraft([site({ host: "bad host!" })])).toEqual({
      ok: true,
      rules: {
        version: 1,
        sites: [
          {
            enabled: true,
            listen: { host: "bad host!", port: 8080 },
            upstreams: [{ scheme: "http", host: "127.0.0.1", port: 3000 }],
          },
        ],
      },
    });
  });

  it("shows the backend host message under the listen host field", () => {
    const mapped = mapIssuesToFields([
      backendIssue({
        site: 0,
        field: "listen.host",
        message: "主机不合法：只允许 IPv4 或 IPv6 字面量。",
      }),
    ]);

    expect(feedbackForField("site.0.listen.host", mapped, {})).toEqual({
      error: "主机不合法：只允许 IPv4 或 IPv6 字面量。",
    });
  });
});

describe("golden: 缺少上游", () => {
  it("builds an empty upstream list locally and leaves the refusal to the backend", () => {
    expect(rulesFromDraft([site({ upstreams: [] })])).toEqual({
      ok: true,
      rules: {
        version: 1,
        sites: [
          {
            enabled: true,
            listen: { host: "127.0.0.1", port: 8080 },
            upstreams: [],
          },
        ],
      },
    });
  });

  it("shows the backend no-upstream message on the site's upstream list", () => {
    const mapped = mapIssuesToFields([
      backendIssue({
        code: "NO_UPSTREAM",
        site: 0,
        field: "upstreams",
        message: "站点至少需要一个上游。",
      }),
    ]);

    expect(feedbackForField("site.0.upstreams", mapped, {})).toEqual({
      error: "站点至少需要一个上游。",
    });
  });
});
