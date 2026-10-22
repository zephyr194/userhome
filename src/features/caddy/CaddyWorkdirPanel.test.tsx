import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CaddyRunStatus, CaddyWorkdirStatus } from "../../ipc/caddy";
import type { AppError } from "../../ipc/core";
import type { GrantSummary } from "../../ipc/grants";
import { CaddySaveBar } from "./CaddySaveBar";
import { CaddyRunView, type CaddyRunViewProps } from "./CaddyRunPanel";
import { CaddyWorkdirPanel } from "./CaddyWorkdirPanel";
import { initialLogView } from "./caddyRunModel";
import { RawEditorView } from "./RawEditor";
import type { WorkdirAction, WorkdirLoad } from "./caddyWorkdirModel";

const NOOP = () => undefined;

const GRANT: GrantSummary = {
  id: "3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b",
  purpose: "CADDY_WORK_DIR",
  kind: "DIRECTORY",
  displayPath: "~/Projects/caddy-home",
  createdAtEpochMs: 1_760_000_000_000,
};

const UNAUTHORIZED: CaddyWorkdirStatus = { defaultDisplayPath: "~/.caddy", legacyDataPresent: false };
const AUTHORIZED: CaddyWorkdirStatus = { ...UNAUTHORIZED, authorized: GRANT };
const LEGACY: CaddyWorkdirStatus = {
  ...AUTHORIZED,
  legacyDataPresent: true,
  legacyDisplayPath: "~/Library/Application Support/UserHome/caddy",
};

const DENIED: AppError = {
  code: "PERMISSION_DENIED",
  message: "受保护目录不能用作工作目录。",
  retryable: false,
};

interface PanelOptions {
  load?: WorkdirLoad;
  action?: WorkdirAction;
  legacyPath?: string;
}

function panel({
  load = { status: "ready", workdir: UNAUTHORIZED },
  action = { status: "idle" },
  legacyPath,
}: PanelOptions = {}) {
  return renderToStaticMarkup(
    <CaddyWorkdirPanel
      load={load}
      action={action}
      legacyPath={legacyPath}
      onRetry={NOOP}
      onSelect={NOOP}
      onUseDefault={NOOP}
      onConfirmRevoke={NOOP}
      onCancelRevoke={NOOP}
      onRevoke={NOOP}
      onDismissLegacy={NOOP}
    />,
  );
}

describe("work directory panel when unauthorized", () => {
  it("offers both ways to choose a directory and names the default with its mode", () => {
    const html = panel();
    expect(html).toContain("使用 ~/.caddy");
    expect(html).toContain("选择其他目录…");
    expect(html).toContain("权限为 0700");
    expect(html).toContain("未选择");
  });

  it("never shows a path input, so the frontend submits no path", () => {
    expect(panel()).not.toMatch(/<input|type="text"/);
  });
});

describe("work directory panel when authorized", () => {
  it("shows the current directory with change and revoke actions", () => {
    const html = panel({ load: { status: "ready", workdir: AUTHORIZED } });
    expect(html).toContain("~/Projects/caddy-home");
    expect(html).toContain("更改目录");
    expect(html).toContain(">撤销<");
    expect(html).not.toContain("使用 ~/.caddy");
  });

  it("asks before revoking and says the rules stay in the directory", () => {
    const html = panel({
      load: { status: "ready", workdir: AUTHORIZED },
      action: { status: "confirmRevoke" },
    });
    expect(html).toContain("确认撤销");
    expect(html).toContain("规则文件保留在原目录");
    expect(html).toContain("需要先选择工作目录");
  });
});

describe("work directory panel notices and errors", () => {
  it("shows the old private directory as a non-blocking notice with dismissal", () => {
    const html = panel({
      load: { status: "ready", workdir: LEGACY },
      legacyPath: "~/Library/Application Support/UserHome/caddy",
    });
    expect(html).toContain("不会自动迁移");
    expect(html).toContain("知道了");
    expect(html).toContain("~/Library/Application Support/UserHome/caddy");
  });

  it("shows the backend message of a failed action and never a success", () => {
    const html = panel({ action: { status: "failed", message: DENIED.message } });
    expect(html).toContain('role="alert"');
    expect(html).toContain("受保护目录不能用作工作目录。");
    expect(html).not.toContain("已设置工作目录");
  });

  it("reports a cancelled picker without claiming a change", () => {
    const html = panel({ action: { status: "notice", message: "已取消，工作目录未更改。" } });
    expect(html).toContain("已取消，工作目录未更改。");
  });

  it("shows the status read failure with a retry", () => {
    const html = panel({ load: { status: "failed", error: DENIED } });
    expect(html).toContain("无法读取工作目录状态：受保护目录不能用作工作目录。");
    expect(html).toContain("重新检查");
  });

  it("shows loading without claiming the directory is missing", () => {
    const html = panel({ load: { status: "loading" } });
    expect(html).toContain("正在检查工作目录");
    expect(html).not.toContain("使用 ~/.caddy");
  });
});

describe("Caddy actions while the work directory is not ready", () => {
  const REASON = "请先选择工作目录";

  it("disables the save bar with the reason instead of letting the user press it", () => {
    const html = renderToStaticMarkup(
      <CaddySaveBar
        gate={{ enabled: false, reason: REASON }}
        saveState={{ status: "idle" }}
        onSave={NOOP}
      />,
    );
    expect(html).toContain(REASON);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>保存规则<\/button>/);
  });

  it("disables preview and apply in the run panel with the reason", () => {
    const status: CaddyRunStatus = { state: "RUNNING", message: "运行中。", diagnostics: [] };
    const props: CaddyRunViewProps = {
      source: "RULES",
      status: {
        ...status,
        applied: "APPLIED",
      } as CaddyRunViewProps["status"],
      busy: false,
      logs: initialLogView(undefined),
      paused: false,
      onPrepare: NOOP,
      onStart: NOOP,
      onCancelSummary: NOOP,
      onStop: NOOP,
      onPauseChange: NOOP,
      onApply: NOOP,
      workdirReason: REASON,
    };
    const html = renderToStaticMarkup(<CaddyRunView {...props} />);
    expect(html).toContain("请先选择工作目录后才能开启或应用配置。");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>开启前预览<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>应用到运行实例<\/button>/);
  });

  it("keeps the raw editor visible but blocks reading, validating and saving", () => {
    const html = renderToStaticMarkup(
      <RawEditorView
        blockReason={REASON}
        text=""
        load={{ status: "loading" }}
        validation={{ status: "idle" }}
        save={{ status: "idle" }}
        onTextChange={NOOP}
        onValidate={NOOP}
        onAllowExternalAndValidate={NOOP}
        onCancel={NOOP}
        onSave={NOOP}
      />,
    );
    expect(html).toContain("请先选择工作目录后才能读取、校验或保存原文。");
    expect(html).not.toContain("正在读取已保存的原文");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>校验<\/button>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>保存原文<\/button>/);
  });
});
