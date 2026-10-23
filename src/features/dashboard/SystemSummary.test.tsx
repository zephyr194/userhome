import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "../../i18n/LocaleProvider";
import type { SystemSummary as SystemSummaryData } from "../../ipc/discovery";
import { SystemSummary } from "./SystemSummary";

const SUMMARY: SystemSummaryData = {
  completeness: "PARTIAL",
  osVersion: "15.0",
  architecture: "arm64",
  homeDirectory: "~",
  shell: "/bin/zsh",
  applications: [
    {
      appId: "git",
      displayName: "Git",
      status: "PARTIAL",
      evidence: [{ kind: "EXECUTABLE_PRESENT", present: true, label: "git" }],
    },
  ],
  issues: [],
};

describe("SystemSummary 英文文案", () => {
  it("在 en 偏好下渲染英文且不含中文字符", () => {
    const markup = renderToStaticMarkup(
      <LocaleProvider preference="en">
        <SystemSummary summary={SUMMARY} />
      </LocaleProvider>,
    );

    expect(markup).toContain("Machine");
    expect(markup).toContain("Partly available");
    expect(markup).toContain("Identified 1 of 1 applications");
    expect(markup).toContain("Show detection evidence");
    expect(markup).toContain("Command available");
    expect(markup).not.toMatch(/[㐀-鿿豈-ﾯ]/);
  });

  it("默认中文渲染保持既有文案", () => {
    const markup = renderToStaticMarkup(<SystemSummary summary={SUMMARY} />);

    expect(markup).toContain("机器信息");
    expect(markup).toContain("已识别 1/1 个应用");
    expect(markup).toContain("命令可用");
  });
});
