import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { decodeDiscoverySnapshot } from "../../ipc/discovery";
import { UnmanagedCandidates } from "./UnmanagedCandidates";

describe("UnmanagedCandidates", () => {
  it("renders names and metadata without any content field", () => {
    const snapshot = decodeDiscoverySnapshot({
      refreshId: "refresh-1",
      startedAtEpochMs: 1,
      completedAtEpochMs: 2,
      system: { status: "LOADING" },
      brew: { status: "LOADING" },
      candidates: {
        status: "READY",
        data: [
          {
            name: ".config",
            kind: "DIRECTORY",
            modifiedAtEpochMs: 1,
          },
        ],
      },
    });
    if (snapshot.candidates.status !== "READY") {
      throw new Error("candidate fixture should decode");
    }

    const markup = renderToStaticMarkup(
      <UnmanagedCandidates state={snapshot.candidates} />,
    );

    expect(markup).toContain(".config");
    expect(markup).toContain("仅显示名称、类型、覆盖分类与修改时间");
    expect(markup).toContain("已发现，暂不支持");
    expect(markup).not.toContain("contents");
    expect(markup).not.toContain("path");
  });

  it("keeps candidate failures isolated", () => {
    const markup = renderToStaticMarkup(
      <UnmanagedCandidates
        state={{
          status: "ERROR",
          error: {
            module: "candidates",
            message: "候选项扫描失败。",
            retryable: true,
          },
        }}
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("候选项扫描失败。");
  });
});
