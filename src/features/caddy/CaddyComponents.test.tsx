import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CaddyDetectReport, CaddyPreview } from "../../ipc/caddy";
import { createIdSource, siteDraftsFromRules, type SiteDraft } from "./caddyRulesModel";
import { CaddyDetectPanel } from "./CaddyDetectPanel";
import { CaddyPreviewPanel } from "./CaddyPreviewPanel";
import { CaddyRulesEditor } from "./CaddyRulesEditor";
import { CaddySaveBar } from "./CaddySaveBar";
import { mapIssuesToFields } from "./caddyRulesModel";
import { CaddyPage } from "./CaddyPage";

const NOOP = () => undefined;

const AVAILABLE: CaddyDetectReport = {
  status: "AVAILABLE",
  executablePath: "/opt/homebrew/Cellar/caddy/2.8.4/bin/caddy",
  version: "v2.8.4 h1:fixture",
  candidates: [{ source: "FIXED", displayPath: "/opt/homebrew/bin/caddy", outcome: "USABLE" }],
};

const SITES: SiteDraft[] = siteDraftsFromRules(
  {
    version: 1,
    sites: [
      {
        enabled: true,
        listen: { host: "127.0.0.1", port: 8080 },
        upstreams: [{ scheme: "http", host: "127.0.0.1", port: 3000 }],
      },
    ],
  },
  createIdSource(),
);

const VALID_PREVIEW: CaddyPreview = {
  valid: true,
  validation: { issues: [], conflicts: [], exposures: [] },
  generatedText: "http://127.0.0.1:8080 {\n\treverse_proxy http://127.0.0.1:3000\n}\n",
  diff: [
    { change: "ADDED", text: "http://127.0.0.1:8080 {" },
    { change: "REMOVED", text: "\treverse_proxy http://127.0.0.1:3005" },
    { change: "ADDED", text: "\treverse_proxy http://127.0.0.1:3000" },
  ],
  hasSavedVersion: true,
};

describe("CaddyDetectPanel", () => {
  it("shows a loading status while detection runs", () => {
    const html = renderToStaticMarkup(
      <CaddyDetectPanel state={{ status: "loading" }} onRetry={NOOP} />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("正在检测 Caddy");
  });

  it("shows the path and version when an executable is available", () => {
    const html = renderToStaticMarkup(
      <CaddyDetectPanel state={{ status: "ready", report: AVAILABLE }} onRetry={NOOP} />,
    );
    expect(html).toContain("/opt/homebrew/Cellar/caddy/2.8.4/bin/caddy");
    expect(html).toContain("v2.8.4 h1:fixture");
    expect(html).toContain("已找到");
  });

  it("states that a version check is not a safety guarantee", () => {
    const html = renderToStaticMarkup(
      <CaddyDetectPanel state={{ status: "ready", report: AVAILABLE }} onRetry={NOOP} />,
    );
    expect(html).toContain("版本检测不是安全保证");
  });

  it("shows the backend guidance and offers no install action when Caddy is missing", () => {
    const guidance = "未找到 Caddy。请先通过 Homebrew 手动安装（brew install caddy）。";
    const html = renderToStaticMarkup(
      <CaddyDetectPanel
        state={{
          status: "ready",
          report: {
            status: "MISSING",
            guidance,
            candidates: [{ source: "FIXED", displayPath: "/usr/local/bin/caddy", outcome: "MISSING" }],
          },
        }}
        onRetry={NOOP}
      />,
    );
    expect(html).toContain(guidance);
    expect(html).not.toMatch(/安装 Caddy|立即安装|一键安装/);
    expect(html).toContain("该位置没有文件");
  });

  it("reports a failed detection as an alert", () => {
    const html = renderToStaticMarkup(
      <CaddyDetectPanel
        state={{ status: "failed", error: { code: "INTERNAL", message: "x", retryable: false } }}
        onRetry={NOOP}
      />,
    );
    expect(html).toContain('role="alert"');
  });
});

describe("CaddyRulesEditor", () => {
  const baseProps = {
    sites: SITES,
    localErrors: {},
    mapped: mapIssuesToFields([]),
    exposedSites: new Set<number>(),
    ids: createIdSource(),
    onChange: NOOP,
  };

  it("labels every rule control with a visible label", () => {
    const html = renderToStaticMarkup(<CaddyRulesEditor {...baseProps} />);
    for (const label of ["启用此站点", "监听主机", "监听端口", "上游协议", "上游主机", "上游端口"]) {
      expect(html, label).toContain(label);
    }
  });

  it("associates a field error with its control through aria-invalid and an alert", () => {
    const html = renderToStaticMarkup(
      <CaddyRulesEditor
        {...baseProps}
        localErrors={{ "site.0.listen.port": "端口必须是 0 到 65535 之间的整数。" }}
      />,
    );
    expect(html).toContain("端口必须是 0 到 65535 之间的整数。");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('role="alert"');
  });

  it("shows a backend conflict message against the field it locates", () => {
    const html = renderToStaticMarkup(
      <CaddyRulesEditor
        {...baseProps}
        mapped={mapIssuesToFields([
          {
            code: "INVALID_HOST",
            severity: "ERROR",
            site: 0,
            field: "listen.host",
            message: "主机不合法：只允许 IPv4 或 IPv6 字面量。",
          },
        ])}
      />,
    );
    expect(html).toContain("主机不合法：只允许 IPv4 或 IPv6 字面量。");
  });

  it("marks a site whose listen address is visible outside the machine", () => {
    const html = renderToStaticMarkup(
      <CaddyRulesEditor {...baseProps} exposedSites={new Set([0])} />,
    );
    expect(html).toContain("对外可见");
  });

  it("disables adding a site once the limit is reached", () => {
    const many = Array.from({ length: 32 }, (_, index) => ({ ...SITES[0]!, key: index + 1 }));
    const html = renderToStaticMarkup(<CaddyRulesEditor {...baseProps} sites={many} />);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>新增站点/);
  });

  it("keeps the only upstream of a site from being removed", () => {
    const html = renderToStaticMarkup(<CaddyRulesEditor {...baseProps} />);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>删除上游/);
  });
});

describe("CaddyPreviewPanel", () => {
  it("asks for corrections instead of showing text while the draft has local errors", () => {
    const html = renderToStaticMarkup(
      <CaddyPreviewPanel localValid={false} preview={{ status: "pending" }} exposures={[]} />,
    );
    expect(html).toContain("请先修正表单中的输入");
    expect(html).not.toContain("生成的 Caddyfile");
  });

  it("shows a pending status while the preview is being prepared", () => {
    const html = renderToStaticMarkup(
      <CaddyPreviewPanel localValid preview={{ status: "pending" }} exposures={[]} />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("正在生成预览");
  });

  it("withholds generated text and lists the reason when validation blocks the rules", () => {
    const html = renderToStaticMarkup(
      <CaddyPreviewPanel
        localValid
        preview={{
          status: "ready",
          preview: {
            valid: false,
            validation: {
              issues: [
                {
                  code: "INVALID_HOST",
                  severity: "ERROR",
                  site: 0,
                  field: "listen.host",
                  message: "主机不合法。",
                },
              ],
              conflicts: [{ listen: "127.0.0.1:8080", sites: [0, 1] }],
              exposures: [],
            },
            hasSavedVersion: false,
          },
        }}
        exposures={[]}
      />,
    );
    expect(html).toContain("校验未通过");
    expect(html).toContain("127.0.0.1:8080");
    expect(html).not.toContain("生成的 Caddyfile");
  });

  it("marks each diff line with a symbol and a text label, not color alone", () => {
    const html = renderToStaticMarkup(
      <CaddyPreviewPanel localValid preview={{ status: "ready", preview: VALID_PREVIEW }} exposures={[]} />,
    );
    expect(html).toContain("新增");
    expect(html).toContain("删除");
    expect(html).toContain("+</span>");
    expect(html).toContain("-</span>");
    expect(html).toContain("reverse_proxy http://127.0.0.1:3005");
  });

  it("warns prominently about every externally visible listen address", () => {
    const html = renderToStaticMarkup(
      <CaddyPreviewPanel
        localValid
        preview={{ status: "ready", preview: VALID_PREVIEW }}
        exposures={[
          { site: 0, listen: "0.0.0.0:9000", visibleExternally: true, reason: "ALL_INTERFACES" },
        ]}
      />,
    );
    expect(html).toContain("0.0.0.0:9000");
    expect(html).toContain("对局域网或外部可见");
  });

  it("says no saved version exists when nothing has been saved yet", () => {
    const html = renderToStaticMarkup(
      <CaddyPreviewPanel
        localValid
        preview={{ status: "ready", preview: { ...VALID_PREVIEW, hasSavedVersion: false } }}
        exposures={[]}
      />,
    );
    expect(html).toContain("尚无已保存版本");
  });
});

describe("CaddySaveBar", () => {
  it("is disabled and explains why when the gate is closed", () => {
    const html = renderToStaticMarkup(
      <CaddySaveBar gate={{ enabled: false, reason: "请先修正表单中的错误。" }} saveState={{ status: "idle" }} onSave={NOOP} />,
    );
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>保存规则/);
    expect(html).toContain("请先修正表单中的错误。");
  });

  it("states that saving neither starts nor reloads Caddy", () => {
    const html = renderToStaticMarkup(
      <CaddySaveBar gate={{ enabled: true }} saveState={{ status: "idle" }} onSave={NOOP} />,
    );
    expect(html).toContain("保存不会启动或重载 Caddy");
  });

  it("reports a partial failure distinctly from a full failure", () => {
    const html = renderToStaticMarkup(
      <CaddySaveBar
        gate={{ enabled: true }}
        saveState={{
          status: "failed",
          error: { code: "PARTIAL_FAILURE", message: "规则已保存，但 Caddyfile 未能更新。", retryable: false },
        }}
        onSave={NOOP}
      />,
    );
    expect(html).toContain("部分保存失败");
    expect(html).toContain("规则已保存，但 Caddyfile 未能更新。");
    expect(html).toContain('role="alert"');
  });

  it("reports a full failure as an alert without claiming partial success", () => {
    const html = renderToStaticMarkup(
      <CaddySaveBar
        gate={{ enabled: true }}
        saveState={{
          status: "failed",
          error: { code: "VALIDATION_FAILED", message: "规则文件损坏。", retryable: false },
        }}
        onSave={NOOP}
      />,
    );
    expect(html).toContain("规则文件损坏。");
    expect(html).not.toContain("部分保存失败");
  });

  it("announces a successful save as a status", () => {
    const html = renderToStaticMarkup(
      <CaddySaveBar gate={{ enabled: true }} saveState={{ status: "saved" }} onSave={NOOP} />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("已保存");
  });
});

describe("CaddyPage", () => {
  it("renders the detection area and a reading state before any rules arrive", () => {
    const html = renderToStaticMarkup(<CaddyPage />);
    expect(html).toContain("Caddy 检测");
    expect(html).toContain("正在检测 Caddy");
    expect(html).toContain("正在读取已保存的规则");
    expect(html).not.toContain("保存规则");
  });
});
