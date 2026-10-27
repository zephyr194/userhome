import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { en } from "../../i18n/messages/en";
import { zhCN } from "../../i18n/messages/zh-CN";
import type { GrantStoreProblem } from "../../ipc/grants";
import {
  isGrantStoreNoticeVisible,
  type GrantStoreNoticeState,
} from "./grantStoreController";
import { GrantStoreNoticeView } from "./GrantStoreNotice";
import { restoreFocus } from "./restoreFocus";

const NAME = "grants.json.corrupt-20261015T133000Z";

function stateOf(
  patch: Partial<GrantStoreNoticeState> = {},
): GrantStoreNoticeState {
  return {
    check: { phase: "available" },
    rechecking: false,
    dialog: { phase: "closed" },
    ...patch,
  };
}

function unavailable(
  reason: GrantStoreProblem,
  patch: Partial<GrantStoreNoticeState> = {},
) {
  return stateOf({ check: { phase: "unavailable", reason }, ...patch });
}

function render(state: GrantStoreNoticeState) {
  return renderToStaticMarkup(
    <GrantStoreNoticeView
      onCancel={() => undefined}
      onConfirm={() => undefined}
      onDismissCompleted={() => undefined}
      onRecheck={() => undefined}
      onRequestReset={() => undefined}
      state={state}
    />,
  );
}

describe("GrantStoreNoticeView", () => {
  it.each([
    ["available", stateOf()],
    ["checking", stateOf({ check: { phase: "checking" } })],
  ])("renders nothing while the store is %s", (_label, state) => {
    expect(isGrantStoreNoticeVisible(state)).toBe(false);
    expect(render(state)).toBe("");
  });

  it("tells a corrupt store apart and offers the reset", () => {
    const markup = render(unavailable("CORRUPT"));

    expect(isGrantStoreNoticeVisible(unavailable("CORRUPT"))).toBe(true);
    expect(markup).toContain("授权存储不可用");
    expect(markup).toContain("已损坏");
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("隔离并重置");
    expect(markup).toContain("重新检测");
    expect(markup).not.toContain("较新版本");
    expect(markup).not.toContain("新版本的授权失效");
  });

  it("says that resetting a newer-version store invalidates the new version's grants", () => {
    const markup = render(unavailable("NEWER_VERSION"));

    expect(markup).toContain("授权存储不可用");
    expect(markup).toContain("较新版本");
    expect(markup).toContain("重置会使新版本的授权失效");
    expect(markup).toContain("隔离并重置");
    expect(markup).not.toContain("已损坏");
  });

  it.each(["NOT_REGULAR_FILE", "IO"] as const)(
    "offers no reset for %s, only manual handling and a re-check",
    (reason) => {
      const markup = render(unavailable(reason));

      expect(markup).toContain("授权存储不可用");
      expect(markup).toContain("手动处理");
      expect(markup).toContain("重新检测");
      expect(markup).not.toContain("隔离并重置");
    },
  );

  it("never shows a path", () => {
    for (const reason of [
      "CORRUPT",
      "NEWER_VERSION",
      "NOT_REGULAR_FILE",
      "IO",
    ] as const) {
      expect(render(unavailable(reason))).not.toMatch(/\/Users|\/home|~\//);
    }
  });

  it("keeps the unknown-status body to its consequence, not a restatement of the title", () => {
    expect(zhCN["grants.recheck.unknownStatus"]).toBe("授权相关操作可能不可用。");
    expect(en["grants.recheck.unknownStatus"]).toBe("Grant-related actions may be unavailable.");
  });

  it("reports an unreadable status as unknown, with a re-check", () => {
    const state = stateOf({ check: { phase: "check-failed" } });
    const markup = render(state);

    expect(isGrantStoreNoticeVisible(state)).toBe(true);
    expect(markup).toContain("授权相关操作可能不可用");
    expect(markup).toContain("重新检测");
    expect(markup).not.toContain("隔离并重置");
  });

  it("disables the re-check while it runs", () => {
    const markup = render(unavailable("CORRUPT", { rechecking: true }));

    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>检测中/);
    expect(markup).toContain('aria-busy="true"');
  });

  describe("confirmation", () => {
    it("explains the effect and focuses cancel by default", () => {
      const markup = render(unavailable("CORRUPT", { dialog: { phase: "asking" } }));

      expect(markup).toContain('role="dialog"');
      expect(markup).toContain('aria-modal="true"');
      expect(markup).toContain('aria-labelledby="grant-store-reset-heading"');
      expect(markup).toContain('id="grant-store-reset-heading"');
      expect(markup).toContain("所有授权需重新选择");
      expect(markup).toContain("原文件会改名保留，不会被删除");
      expect(markup).not.toContain("新版本的授权失效");
      const cancel = markup.match(/<button[^>]*data-dialog-cancel[^>]*>/);
      expect(cancel?.[0]).toBeDefined();
      expect(cancel?.[0]).not.toContain('disabled=""');
      expect(markup).toContain(">取消<");
      expect(markup.indexOf("data-dialog-cancel")).toBeLessThan(
        markup.lastIndexOf("隔离并重置</button>"),
      );
    });

    it("warns about the newer version in the confirmation too", () => {
      const markup = render(
        unavailable("NEWER_VERSION", { dialog: { phase: "asking" } }),
      );

      expect(markup).toContain("重置会使新版本的授权失效");
      expect(markup).toContain("所有授权需重新选择");
    });

    it("disables both buttons and announces progress while resetting", () => {
      const markup = render(
        unavailable("CORRUPT", { dialog: { phase: "resetting" } }),
      );

      const dialog = markup.slice(markup.indexOf('role="dialog"'));
      expect(dialog.match(/<button[^>]*disabled=""/g)).toHaveLength(2);
      expect(dialog).toMatch(/role="status"[^>]*aria-live="polite"|aria-live="polite"[^>]*role="status"/);
      expect(dialog).toContain("正在隔离并重置");
      expect(markup).toMatch(/<section[^>]*aria-busy="true"[^>]*role="dialog"/);
    });

    it("shows the refusal message as an alert and allows a retry", () => {
      const markup = render(
        unavailable("CORRUPT", {
          dialog: {
            phase: "failed",
            failure: {
              code: "PERMISSION_DENIED",
              message: "The authorization store could not be isolated.",
            },
          },
        }),
      );

      expect(markup).toContain("重置未完成");
      expect(markup).toContain("The authorization store could not be isolated.");
      expect(markup).toMatch(/role="alert"[^>]*>[^]*could not be isolated/);
      expect(markup).toContain("重试隔离并重置");
    });

    it("names the quarantine file after a partial failure", () => {
      const markup = render(
        unavailable("CORRUPT", {
          dialog: {
            phase: "failed",
            failure: {
              code: "PARTIAL_FAILURE",
              message: `The old authorization store was set aside as ${NAME}, but a new one could not be created. Try again.`,
            },
          },
        }),
      );

      expect(markup).toContain(NAME);
      expect(markup).toContain("已改名保留");
      expect(markup).toContain("没有授权库文件");
    });

    it("does not claim success for an unconfirmed internal failure", () => {
      const markup = render(
        unavailable("CORRUPT", {
          dialog: {
            phase: "failed",
            failure: { code: "INTERNAL", message: "An internal error occurred." },
          },
        }),
      );

      expect(markup).toContain("无法确认重置结果");
      expect(markup).not.toContain("已重置");
    });

    it("lets long messages wrap", () => {
      const markup = render(
        unavailable("CORRUPT", {
          dialog: {
            phase: "failed",
            failure: { code: "CONFLICT", message: "x".repeat(300) },
          },
        }),
      );

      expect(markup).toContain("break-words");
      expect(markup).toContain("[overflow-wrap:anywhere]");
    });
  });

  it("shows the completion note with the quarantine file name once reset", () => {
    const state = stateOf({
      completed: { quarantineFileName: NAME, previousReason: "CORRUPT" },
    });
    const markup = render(state);

    expect(isGrantStoreNoticeVisible(state)).toBe(true);
    expect(markup).toContain('role="status"');
    expect(markup).toContain("授权存储已重置");
    expect(markup).toContain(NAME);
    expect(markup).toContain("不会被删除");
    expect(markup).toContain("所有授权需重新选择");
    expect(markup).not.toContain("授权存储不可用");
  });
});

describe("restoreFocus", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function fakeElement(isConnected: boolean) {
    return { focus: vi.fn(), isConnected } as unknown as HTMLElement & {
      focus: ReturnType<typeof vi.fn>;
    };
  }

  it("focuses the trigger when it is still on the page", () => {
    vi.useFakeTimers();
    const trigger = fakeElement(true);
    const main = fakeElement(true);
    vi.stubGlobal("document", { getElementById: () => main });

    restoreFocus(trigger);
    expect(trigger.focus).not.toHaveBeenCalled();
    vi.runAllTimers();

    expect(trigger.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(main.focus).not.toHaveBeenCalled();
  });

  it("falls back to the main content when the trigger is gone", () => {
    vi.useFakeTimers();
    const trigger = fakeElement(false);
    const main = fakeElement(true);
    const getElementById = vi.fn(() => main);
    vi.stubGlobal("document", { getElementById });

    restoreFocus(trigger);
    vi.runAllTimers();

    expect(trigger.focus).not.toHaveBeenCalled();
    expect(getElementById).toHaveBeenCalledWith("main-content");
    expect(main.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("falls back to the main content without a trigger", () => {
    vi.useFakeTimers();
    const main = fakeElement(true);
    vi.stubGlobal("document", { getElementById: () => main });

    restoreFocus(null);
    vi.runAllTimers();

    expect(main.focus).toHaveBeenCalled();
  });
});
