import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "../../i18n/LocaleProvider";
import type { GrantStoreNoticeState } from "./grantStoreController";
import { GrantStoreNoticeView } from "./GrantStoreNotice";

const CJK_PATTERN = /[㐀-鿿豈-﫿]/;

function render(state: GrantStoreNoticeState) {
  return renderToStaticMarkup(
    <LocaleProvider preference="en">
      <GrantStoreNoticeView
        onCancel={() => undefined}
        onConfirm={() => undefined}
        onDismissCompleted={() => undefined}
        onRecheck={() => undefined}
        onRequestReset={() => undefined}
        state={state}
      />
    </LocaleProvider>,
  );
}

const BASE = {
  rechecking: false,
  dialog: { phase: "closed" },
} as const;

describe("GrantStoreNoticeView in English", () => {
  it("renders the corrupt-store notice and the reset action without Chinese text", () => {
    const html = render({
      ...BASE,
      check: { phase: "unavailable", reason: "CORRUPT" },
    } as GrantStoreNoticeState);

    expect(html).toContain("Grant store unavailable");
    expect(html).toContain("Quarantine and reset");
    expect(html).toContain("Recheck");
    expect(CJK_PATTERN.test(html)).toBe(false);
  });

  it("renders the reset-completed notice in English", () => {
    const html = render({
      ...BASE,
      check: { phase: "available" },
      completed: {
        quarantineFileName: "grants.json.corrupt",
        previousReason: "NEWER_VERSION",
      },
    } as unknown as GrantStoreNoticeState);

    expect(html).toContain("Grant store reset");
    expect(html).toContain("Got it");
    expect(CJK_PATTERN.test(html)).toBe(false);
  });
});
