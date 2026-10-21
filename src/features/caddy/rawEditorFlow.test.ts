import { describe, expect, it } from "vitest";
import type { CaddyValidationReport } from "../../ipc/caddy";
import type { AppError } from "../../ipc/core";
import {
  EXTERNAL_REFERENCE_NOTE,
  isResultStale,
  isRunning,
  referenceLabel,
  stageLabel,
  summarizeFailure,
  summarizeReport,
  type ValidationState,
} from "./rawEditorFlow";

const LIMITATION = "validate 会 provision（加载）配置中的模块";

function report(overrides: Partial<CaddyValidationReport>): CaddyValidationReport {
  return {
    status: "VALID",
    externalReferences: [],
    diagnostics: [],
    limitation: LIMITATION,
    ...overrides,
  };
}

describe("summarizeReport", () => {
  it("reports a valid configuration as a success", () => {
    const summary = summarizeReport(report({ stage: "VALIDATE" }));

    expect(summary.tone).toBe("success");
    expect(summary.title).toBe("校验通过");
    expect(summary.canAllowExternal).toBe(false);
  });

  it("names the failing stage and keeps line numbers and the original wording", () => {
    const summary = summarizeReport(
      report({
        status: "INVALID",
        stage: "ADAPT",
        diagnostics: [{ line: 4, message: "adapting config: Caddyfile:4: unknown directive: x" }],
      }),
    );

    expect(summary.tone).toBe("danger");
    expect(summary.title).toBe("校验未通过：结构解析失败（adapt）");
    expect(summary.details).toEqual([
      "第 4 行：adapting config: Caddyfile:4: unknown directive: x",
    ]);
  });

  it("distinguishes a module failure in the validate stage", () => {
    const summary = summarizeReport(
      report({
        status: "INVALID",
        stage: "VALIDATE",
        diagnostics: [{ message: "module not found" }],
      }),
    );

    expect(summary.title).toBe("校验未通过：模块加载失败（validate）");
    expect(summary.details).toEqual(["module not found"]);
  });

  it("asks for explicit permission when external references are present", () => {
    const summary = summarizeReport(
      report({
        status: "EXTERNAL_REFERENCES",
        externalReferences: [
          { kind: "IMPORT", line: 1 },
          { kind: "ENV_PLACEHOLDER", line: 3 },
        ],
      }),
    );

    expect(summary.tone).toBe("warning");
    expect(summary.title).toBe("含外部引用，需要显式允许");
    expect(summary.canAllowExternal).toBe(true);
    expect(summary.details).toEqual([
      "第 1 行：import 引用其他文件",
      "第 3 行：{env.*} 或 {$变量} 会读取环境变量",
      EXTERNAL_REFERENCE_NOTE,
    ]);
  });

  it("states that timeouts and cancellations are not verdicts", () => {
    expect(summarizeReport(report({ status: "TIMEOUT" })).title).toBe(
      "校验超时，已停止（结果未知）",
    );
    expect(summarizeReport(report({ status: "CANCELLED" })).title).toBe("已取消校验");
    expect(summarizeReport(report({ status: "OUTPUT_TOO_LARGE" })).tone).toBe("danger");
  });

  it("explains an unavailable executable with its guidance", () => {
    const summary = summarizeReport(
      report({
        status: "UNAVAILABLE",
        diagnostics: [{ message: "未找到可用的 Caddy 可执行文件，请先检测或选择。" }],
      }),
    );

    expect(summary.title).toBe("无法运行 Caddy");
    expect(summary.details).toEqual(["未找到可用的 Caddy 可执行文件，请先检测或选择。"]);
  });

  it("maps every reference kind and stage to a label", () => {
    expect(referenceLabel("IMPORT")).toContain("import");
    expect(referenceLabel("FILE_PLACEHOLDER")).toContain("{file.*}");
    expect(referenceLabel("TLS_ARGUMENTS")).toContain("tls");
    expect(stageLabel("ADAPT")).toContain("adapt");
    expect(stageLabel("VALIDATE")).toContain("validate");
  });
});

describe("validation state helpers", () => {
  const done: ValidationState = {
    status: "done",
    report: report({}),
    allowExternalReferences: false,
    checkedText: "a\n",
  };

  it("treats a result as stale once the text differs from what was checked", () => {
    expect(isResultStale(done, "a\n")).toBe(false);
    expect(isResultStale(done, "a\nb\n")).toBe(true);
    expect(isResultStale({ status: "idle" }, "anything")).toBe(false);
  });

  it("marks a failed request stale when the text changes too", () => {
    const error: AppError = { code: "INTERNAL", message: "x", retryable: false };
    const failed: ValidationState = { status: "failed", error, checkedText: "a" };

    expect(isResultStale(failed, "b")).toBe(true);
    expect(summarizeFailure(error).title).toBe("校验请求失败");
  });

  it("knows when a run is in progress", () => {
    expect(
      isRunning({
        status: "running",
        runId: "run-1",
        allowExternalReferences: false,
        checkedText: "a",
      }),
    ).toBe(true);
    expect(isRunning(done)).toBe(false);
  });
});
