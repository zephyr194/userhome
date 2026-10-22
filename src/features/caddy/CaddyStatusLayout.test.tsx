import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CaddyDetectReport, CaddyRules } from "../../ipc/caddy";
import { CaddyDetectPanel, type DetectState } from "./CaddyDetectPanel";
import { CaddyPage } from "./CaddyPage";
import { CaddyRulesEditor } from "./CaddyRulesEditor";
import { createIdSource, mapIssuesToFields, siteDraftsFromRules } from "./caddyRulesModel";

const NOOP = () => undefined;

const AVAILABLE: CaddyDetectReport = {
  status: "AVAILABLE",
  executablePath: "/opt/homebrew/Cellar/caddy/2.8.4/bin/caddy",
  version: "v2.8.4 h1:fixture",
  candidates: [{ source: "FIXED", displayPath: "/opt/homebrew/bin/caddy", outcome: "USABLE" }],
};

const RULES: CaddyRules = {
  version: 1,
  sites: [
    {
      enabled: true,
      listen: { host: "127.0.0.1", port: 8080 },
      upstreams: [
        { scheme: "http", host: "127.0.0.1", port: 3000 },
        { scheme: "http", host: "127.0.0.1", port: 3001 },
      ],
    },
  ],
};

function editor(): string {
  return renderToStaticMarkup(
    <CaddyRulesEditor
      sites={siteDraftsFromRules(RULES, createIdSource())}
      localErrors={{}}
      mapped={mapIssuesToFields([])}
      exposedSites={new Set()}
      ids={createIdSource()}
      onChange={NOOP}
    />,
  );
}

function buttonTag(html: string, label: string): string {
  return html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? "";
}

function detect(state: DetectState): string {
  return renderToStaticMarkup(<CaddyDetectPanel state={state} onRetry={NOOP} />);
}

function page(): string {
  return renderToStaticMarkup(<CaddyPage />);
}

describe("Caddy 检测区占位（FE-3）", () => {
  it("loading and ready use the same reserved result line", () => {
    const loading = detect({ status: "loading" });
    const ready = detect({ status: "ready", report: AVAILABLE });
    expect(loading).toContain("caddy-status__line");
    expect(ready).toContain("caddy-status__line");
    expect(loading).not.toContain("已找到");
    expect(ready).toContain("已找到");
  });

  it("keeps the candidate list collapsed but the safety note always visible", () => {
    const html = detect({ status: "ready", report: AVAILABLE });
    expect(html).toMatch(/<details(?![^>]*\sopen)[^>]*>\s*<summary[^>]*>检测详情<\/summary>/);
    expect(html.indexOf("版本检测不是安全保证")).toBeLessThan(html.indexOf("<details"));
    expect(html).toContain("检测过的位置");
  });
});

describe("规则行（FE-3）", () => {
  it("shows the directive label on the first row only", () => {
    const html = editor();
    expect(html.match(/<span class="text-transparent">指令<\/span>/g)).toHaveLength(3);
  });

  it("turns a required listen delete into a disabled icon with the reason as its title", () => {
    const tag = buttonTag(editor(), "删除监听主机（站点 1）");
    expect(tag).toContain('disabled=""');
    expect(tag).toContain('title="必填指令，不能删除。"');
    expect(editor()).not.toContain("删除监听主机</button>");
  });

  it("keeps the upstream delete as text and puts the reason in its title while it is the only one", () => {
    const html = renderToStaticMarkup(
      <CaddyRulesEditor
        sites={siteDraftsFromRules(
          { version: 1, sites: [{ ...RULES.sites[0]!, upstreams: [RULES.sites[0]!.upstreams[0]!] }] },
          createIdSource(),
        )}
        localErrors={{}}
        mapped={mapIssuesToFields([])}
        exposedSites={new Set()}
        ids={createIdSource()}
        onChange={NOOP}
      />,
    );
    const tag = buttonTag(html, "删除上游 1（站点 1）");
    expect(tag).toContain('disabled=""');
    expect(tag).toContain('title="至少保留一个上游。"');
  });

  it("puts the site delete in an outlined secondary style, not a solid danger button", () => {
    const tag = buttonTag(editor(), "删除站点 1");
    expect(tag).toContain("caddy-danger-outline");
    expect(tag).not.toContain("bg-danger ");
  });
});

describe("Caddy 页状态条（FE-3）", () => {
  it("places workdir and detect in one status panel above the editor", () => {
    const html = page();
    const panel = html.search(/class="[^"]*\bcaddy-status\b/);
    expect(panel).toBeGreaterThan(-1);
    expect(html.indexOf("工作目录")).toBeGreaterThan(panel);
    expect(html.indexOf("Caddy 检测")).toBeGreaterThan(panel);
    expect(html.indexOf("正在读取已保存的规则")).toBeGreaterThan(html.indexOf("Caddy 检测"));
  });
});
