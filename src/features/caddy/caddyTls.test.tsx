import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CaddyRules, CaddyTlsSiteStatus } from "../../ipc/caddy";
import {
  ACCESS_LOG_PRIVACY_NOTICE,
  TLS_FILES_NOTICE,
  createIdSource,
  rulesFromDraft,
  siteDraftsFromRules,
  siteTlsKey,
  tlsFileLine,
  withTlsGrant,
  type SiteDraft,
} from "./caddyRulesModel";
import { CaddyRulesEditor } from "./CaddyRulesEditor";

const CERT_ID = "3f2b8c1e-6a4d-4b7e-9c2f-1a2b3c4d5e6f";
const KEY_ID = "7c9d0e1f-2a3b-4c5d-8e6f-7a8b9c0d1e2f";
const NOOP = () => undefined;

const SAVED: CaddyRules = {
  version: 1,
  sites: [
    {
      enabled: true,
      listen: { host: "app.example.test", port: 8443 },
      upstreams: [{ scheme: "http", host: "127.0.0.1", port: 3000 }],
      tls: { certificateGrantId: CERT_ID, privateKeyGrantId: KEY_ID },
      accessLog: true,
    },
  ],
};

function drafts(rules: CaddyRules): SiteDraft[] {
  return siteDraftsFromRules(rules, createIdSource());
}

function editorMarkup(sites: SiteDraft[], statuses: CaddyTlsSiteStatus[] = []): string {
  return renderToStaticMarkup(
    <CaddyRulesEditor
      sites={sites}
      localErrors={{}}
      mapped={{ byField: {}, general: [] }}
      exposedSites={new Set()}
      tlsStatuses={statuses}
      ids={createIdSource()}
      onChange={NOOP}
      onPickTlsFile={NOOP}
    />,
  );
}

describe("TLS and access log drafts", () => {
  it("keeps grant ids and the access log flag from saved rules", () => {
    const [site] = drafts(SAVED);

    expect(site.tls).toEqual({ certificateGrantId: CERT_ID, privateKeyGrantId: KEY_ID });
    expect(site.accessLog).toBe(true);
  });

  it("treats saved rules without the new keys as plain HTTP with no log", () => {
    const [site] = drafts({ version: 1, sites: [{ ...SAVED.sites[0], tls: undefined, accessLog: undefined }] });

    expect(site.tls).toBeNull();
    expect(site.accessLog).toBe(false);
  });

  it("builds TLS and access log into the request only when they are set", () => {
    const built = rulesFromDraft(drafts(SAVED));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.rules.sites[0].tls).toEqual({ certificateGrantId: CERT_ID, privateKeyGrantId: KEY_ID });
    expect(built.rules.sites[0].accessLog).toBe(true);

    const plain = rulesFromDraft(drafts({ version: 1, sites: [{ ...SAVED.sites[0], tls: undefined, accessLog: false }] }));
    expect(plain.ok && plain.rules.sites[0]).not.toHaveProperty("tls");
    expect(plain.ok && plain.rules.sites[0]).not.toHaveProperty("accessLog");
  });

  it("reports TLS turned on without both files and never builds the rules", () => {
    const site = drafts(SAVED)[0];
    const incomplete = [{ ...site, tls: { certificateGrantId: CERT_ID } }];
    const result = rulesFromDraft(incomplete);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[siteTlsKey(0)]).toContain("证书文件与私钥文件");
  });

  it("sets only the slot that was picked", () => {
    const site = drafts({ version: 1, sites: [{ ...SAVED.sites[0], tls: undefined }] });
    const next = withTlsGrant(site, 0, "privateKey", KEY_ID);

    expect(next[0].tls).toEqual({ privateKeyGrantId: KEY_ID });
  });
});

describe("TLS file status text", () => {
  it("shows the unselected state with a symbol", () => {
    expect(tlsFileLine("certificate", undefined, undefined)).toEqual({
      symbol: "○",
      text: "未选择证书文件",
    });
  });

  it("shows only the file name for a ready file", () => {
    const status: CaddyTlsSiteStatus = {
      site: 0,
      state: "READY",
      certificateName: "cert.pem",
      privateKeyName: "key.pem",
      warnings: [],
    };

    expect(tlsFileLine("certificate", CERT_ID, status)).toEqual({ symbol: "✓", text: "已选择：cert.pem" });
    expect(tlsFileLine("privateKey", KEY_ID, status)).toEqual({ symbol: "✓", text: "已选择：key.pem" });
  });

  it("warns on a private key that others can read, without refusing it", () => {
    const status: CaddyTlsSiteStatus = {
      site: 0,
      state: "WARNING",
      certificateName: "cert.pem",
      privateKeyName: "key.pem",
      warnings: ["PRIVATE_KEY_READABLE_BY_OTHERS"],
    };
    const line = tlsFileLine("privateKey", KEY_ID, status);

    expect(line.symbol).toBe("⚠");
    expect(line.text).toContain("组或其他用户可读");
    expect(tlsFileLine("certificate", CERT_ID, status).symbol).toBe("✓");
  });

  it("shows a revoked authorization on the line whose file it concerns", () => {
    const status: CaddyTlsSiteStatus = {
      site: 0,
      state: "BLOCKED",
      warnings: [],
      message: "私钥授权已撤销，请重新选择私钥文件。",
    };

    expect(tlsFileLine("privateKey", KEY_ID, status)).toEqual({
      symbol: "✕",
      text: "私钥授权已撤销，请重新选择私钥文件。",
    });
    expect(tlsFileLine("certificate", CERT_ID, status).text).toContain("未通过检查");
  });

  it("never shows a directory in any status text", () => {
    const status: CaddyTlsSiteStatus = {
      site: 0,
      state: "READY",
      certificateName: "cert.pem",
      privateKeyName: "key.pem",
      warnings: [],
    };

    expect(JSON.stringify(tlsFileLine("certificate", CERT_ID, status))).not.toContain("/");
  });
});

describe("TLS and access log controls", () => {
  it("renders the TLS file rows, status and the file notice for a TLS site", () => {
    const markup = editorMarkup(drafts(SAVED), [
      {
        site: 0,
        state: "READY",
        certificateName: "cert.pem",
        privateKeyName: "key.pem",
        warnings: [],
      },
    ]);

    expect(markup).toContain("使用 HTTPS（已有证书与私钥）");
    expect(markup).toContain("选择证书文件");
    expect(markup).toContain("选择私钥文件");
    expect(markup).toContain("已选择：cert.pem");
    expect(markup).toContain("已选择：key.pem");
    expect(markup).toContain(TLS_FILES_NOTICE);
    expect(markup).not.toContain("/Users");
  });

  it("hides the file rows when TLS is off", () => {
    const markup = editorMarkup(drafts({ version: 1, sites: [{ ...SAVED.sites[0], tls: undefined }] }));

    expect(markup).toContain("使用 HTTPS（已有证书与私钥）");
    expect(markup).not.toContain("选择证书文件");
  });

  it("shows the access log privacy notice before and while the log is on", () => {
    const off = editorMarkup(drafts({ version: 1, sites: [{ ...SAVED.sites[0], accessLog: false }] }));
    const on = editorMarkup(drafts(SAVED));

    expect(off).toContain("记录访问日志");
    expect(off).toContain(ACCESS_LOG_PRIVACY_NOTICE);
    expect(on).toContain(ACCESS_LOG_PRIVACY_NOTICE);
  });
});
