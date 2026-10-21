import { describe, expect, it } from "vitest";
import {
  decodeCaddyRules,
  decodeTlsStatuses,
  toRulesRequest,
  type CaddyRules,
  type CaddySite,
} from "./caddy";

const CERT_ID = "3f2b8c1e-6a4d-4b7e-9c2f-1a2b3c4d5e6f";
const KEY_ID = "7c9d0e1f-2a3b-4c5d-8e6f-7a8b9c0d1e2f";

const LEGACY_SITE: CaddySite = {
  enabled: true,
  listen: { host: "127.0.0.1", port: 8080 },
  upstreams: [{ scheme: "http", host: "127.0.0.1", port: 3000 }],
};

function rulesWith(site: object) {
  return { version: 1, sites: [site] };
}

describe("caddy rules decoding", () => {
  it("still decodes a payload written before TLS and access log existed", () => {
    const rules = decodeCaddyRules(rulesWith(LEGACY_SITE));

    expect(rules.sites[0]).toEqual(LEGACY_SITE);
    expect(rules.sites[0]).not.toHaveProperty("tls");
    expect(rules.sites[0]).not.toHaveProperty("accessLog");
  });

  it("decodes grant ids and the access log flag", () => {
    const rules = decodeCaddyRules(
      rulesWith({
        ...LEGACY_SITE,
        tls: { certificateGrantId: CERT_ID, privateKeyGrantId: KEY_ID },
        accessLog: true,
      }),
    );

    expect(rules.sites[0].tls).toEqual({
      certificateGrantId: CERT_ID,
      privateKeyGrantId: KEY_ID,
    });
    expect(rules.sites[0].accessLog).toBe(true);
  });

  it("refuses a TLS block that carries a path or key material", () => {
    for (const tls of [
      { certificateGrantId: CERT_ID, privateKeyGrantId: KEY_ID, certificatePath: "/a/b.pem" },
      { certificateGrantId: CERT_ID, privateKeyGrantId: KEY_ID, privateKey: "-----BEGIN" },
    ]) {
      expect(() => decodeCaddyRules(rulesWith({ ...LEGACY_SITE, tls }))).toThrow();
    }
  });

  it("refuses a TLS grant id that is not an authorization id", () => {
    expect(() =>
      decodeCaddyRules(
        rulesWith({
          ...LEGACY_SITE,
          tls: { certificateGrantId: "/Users/a/cert.pem", privateKeyGrantId: KEY_ID },
        }),
      ),
    ).toThrow();
  });

  it("refuses an unknown site key so a stray path cannot ride along", () => {
    expect(() =>
      decodeCaddyRules(rulesWith({ ...LEGACY_SITE, logPath: "/tmp/access.log" })),
    ).toThrow();
  });
});

describe("caddy TLS request body", () => {
  it("keeps only grant ids and the flag, and never a path", () => {
    const rules: CaddyRules = {
      version: 1,
      sites: [
        {
          ...LEGACY_SITE,
          tls: { certificateGrantId: CERT_ID, privateKeyGrantId: KEY_ID },
          accessLog: true,
        },
      ],
    };
    const body = JSON.stringify(toRulesRequest(rules));

    expect(body).toContain(CERT_ID);
    expect(body).toContain(KEY_ID);
    expect(body).toContain('"accessLog":true');
    expect(body).not.toContain("/");
  });

  it("omits the optional keys when TLS and access log are not set", () => {
    const body = toRulesRequest({ version: 1, sites: [LEGACY_SITE] });

    expect(body.sites[0]).not.toHaveProperty("tls");
    expect(body.sites[0]).not.toHaveProperty("accessLog");
  });
});

describe("caddy TLS status decoding", () => {
  it("decodes names and warnings for a ready and a warned site", () => {
    const statuses = decodeTlsStatuses([
      {
        site: 0,
        state: "READY",
        certificateName: "cert.pem",
        privateKeyName: "key.pem",
        warnings: [],
      },
      {
        site: 1,
        state: "WARNING",
        certificateName: "cert.pem",
        privateKeyName: "key.pem",
        warnings: ["PRIVATE_KEY_READABLE_BY_OTHERS"],
      },
    ]);

    expect(statuses[1]).toEqual({
      site: 1,
      state: "WARNING",
      certificateName: "cert.pem",
      privateKeyName: "key.pem",
      warnings: ["PRIVATE_KEY_READABLE_BY_OTHERS"],
    });
  });

  it("decodes a blocked site with its fixed message", () => {
    const [blocked] = decodeTlsStatuses([
      { site: 0, state: "BLOCKED", warnings: [], message: "私钥授权已撤销，请重新选择私钥文件。" },
    ]);

    expect(blocked.state).toBe("BLOCKED");
    expect(blocked.message).toBe("私钥授权已撤销，请重新选择私钥文件。");
    expect(blocked).not.toHaveProperty("privateKeyName");
  });

  it("refuses a file name that carries a directory", () => {
    expect(() =>
      decodeTlsStatuses([
        { site: 0, state: "READY", certificateName: "/Users/a/cert.pem", privateKeyName: "key.pem", warnings: [] },
      ]),
    ).toThrow();
  });

  it("refuses an unknown state", () => {
    expect(() => decodeTlsStatuses([{ site: 0, state: "OK", warnings: [] }])).toThrow();
  });
});
