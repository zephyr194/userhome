import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BackupHistory } from "./BackupHistory";

describe("BackupHistory", () => {
  it("shows sanitized metadata without configuration content", () => {
    const markup = renderToStaticMarkup(
      <BackupHistory
        backups={[
          {
            backupId: "backup-1-safe",
            appId: "npm",
            configId: "npm-user-config",
            createdAtEpochMs: 1_700_000_000_000,
            contentHash: "a".repeat(64),
            sizeBytes: 32,
            mode: 0o600,
          },
        ]}
        onPreviewRestore={() => undefined}
      />,
    );

    expect(markup).toContain("32 bytes");
    expect(markup).toContain("权限 600");
    expect(markup).toContain("预览恢复");
    expect(markup).not.toContain("contentHash");
    expect(markup).not.toContain("token");
  });
});
