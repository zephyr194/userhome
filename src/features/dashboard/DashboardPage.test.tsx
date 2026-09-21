import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DiscoverySnapshot } from "../../ipc/discovery";
import { decodeDiscoverySnapshot } from "../../ipc/discovery";
import { DashboardPage } from "./DashboardPage";

const partialSnapshot: DiscoverySnapshot = {
  refreshId: "refresh-1",
  startedAtEpochMs: 1,
  system: {
    status: "READY",
    data: {
      completeness: "PARTIAL",
      osVersion: "15.0",
      architecture: "arm64",
      homeDirectory: "~",
      shell: "PATH/zsh",
      applications: [
        {
          appId: "git",
          displayName: "Git",
          status: "PARTIAL",
          evidence: [
            {
              kind: "CONFIG_PRESENT",
              present: true,
              label: "~/.gitconfig",
              path: {
                displayPath: "~/.gitconfig",
                kind: "FILE",
              },
            },
            {
              kind: "EXECUTABLE_PRESENT",
              present: false,
              label: "git",
            },
          ],
        },
      ],
      issues: [
        {
          module: "shell",
          message: "Login shell is unavailable.",
          retryable: false,
        },
      ],
    },
  },
  brew: { status: "LOADING" },
  candidates: { status: "LOADING" },
};

describe("DashboardPage", () => {
  it("renders local metadata and explicit detection evidence while brew loads", () => {
    const markup = renderToStaticMarkup(
      <DashboardPage state={{ status: "ready", snapshot: partialSnapshot }} />,
    );

    expect(markup).toContain("15.0");
    expect(markup).toContain("arm64");
    expect(markup).toContain("~");
    expect(markup).toContain("配置存在");
    expect(markup).toContain("未发现命令");
    expect(markup).toContain("部分结果");
    expect(markup).toContain("正在后台读取软件清单");
  });

  it("keeps a failed local module separate from the dashboard shell", () => {
    const snapshot: DiscoverySnapshot = {
      ...partialSnapshot,
      system: {
        status: "ERROR",
        error: {
          module: "system",
          message: "本机发现超时。",
          retryable: true,
        },
      },
    };
    const markup = renderToStaticMarkup(
      <DashboardPage state={{ status: "ready", snapshot }} />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("本机发现超时。");
    expect(markup).toContain("正在后台读取软件清单");
  });

  it("accepts absent evidence paths serialized as null", () => {
    const snapshot = decodeDiscoverySnapshot({
      ...partialSnapshot,
      system: {
        status: "READY",
        data: {
          ...(partialSnapshot.system.status === "READY"
            ? partialSnapshot.system.data
            : {}),
          applications: [
            {
              appId: "git",
              displayName: "Git",
              status: "ABSENT",
              evidence: [
                {
                  kind: "CONFIG_PRESENT",
                  present: false,
                  label: "~/.gitconfig",
                  path: null,
                },
              ],
            },
          ],
        },
      },
    });

    expect(snapshot.system.status).toBe("READY");
  });
});
