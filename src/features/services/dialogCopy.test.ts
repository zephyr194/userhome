import { describe, expect, it } from "vitest";
import type { AppError } from "../../ipc/core";
import type { AdoptExecution } from "../../ipc/servicesAdopt";
import type { CreateServiceExecution } from "../../ipc/services";
import { CREATE_SERVICE_LIMITS } from "../../ipc/services";
import { describeAdoptFailure, describeAdoptSuccess } from "./adoptServiceModel";
import { describeEditFailure, describeEditOutcome, grantNotice } from "./editServiceModel";
import {
  INITIAL_CREATE_FORM,
  describeCreateOutcome,
  scrubSecrets,
  validateCreateForm,
  type CreateFormState,
} from "./createServiceModel";
import { tEn } from "./testTranslators";

const CJK_PATTERN = /[㐀-鿿豈-﫿]/;

function execution(fileState: string, status = "FAILED") {
  return {
    filePath: "~/Library/LaunchAgents/com.example.userhome.agent.demo.plist",
    outcome: { status, fileState },
  } as unknown as CreateServiceExecution;
}

function error(code: string, message = "Backend reason"): AppError {
  return { code, message, retryable: false } as unknown as AppError;
}

describe("English dialog copy", () => {
  it("writes every create-form error in English", () => {
    const form: CreateFormState = {
      ...INITIAL_CREATE_FORM,
      labelSuffix: "bad..name",
      executable: "relative/tool",
      arguments: [
        { id: 1, value: "" },
        { id: 2, value: "-c" },
        { id: 3, value: "x".repeat(CREATE_SERVICE_LIMITS.argumentBytes + 1) },
      ],
      environment: [
        { id: 4, key: "", value: "value" },
        { id: 5, key: "DYLD_X", value: "a\nb" },
        { id: 6, key: "DYLD_X", value: "" },
      ],
      workingDirectory: "/tmp/../x",
      stdoutPath: "~/out.log",
      stderrPath: "/tmp/",
      nextRowId: 7,
    };
    const errors = validateCreateForm(form, tEn);
    const texts = JSON.stringify(errors);
    expect(CJK_PATTERN.test(texts)).toBe(false);
    expect(errors.label).toBe(tEn("services.dialog.error.labelPattern"));
    expect(errors.executable).toContain("Executable path");
    expect(errors.workingDirectory).toContain("Working directory");
    expect(errors.stdoutPath).toContain("absolute path");
  });

  it("writes the create outcome in English for each file state", () => {
    const written = describeCreateOutcome(execution("WRITTEN", "SUCCEEDED"), tEn);
    expect(written.title).toBe("Created the configuration file ~/Library/LaunchAgents/com.example.userhome.agent.demo.plist");
    for (const state of ["CREATED_REMOVED", "CREATED_REMOVE_FAILED", "UNKNOWN", "NOT_A_STATE"]) {
      const outcome = describeCreateOutcome(execution(state), tEn);
      expect(CJK_PATTERN.test(`${outcome.title}${outcome.detail}`), state).toBe(false);
    }
  });

  it("writes adoption notices in English and keeps backend text as it is", () => {
    const notFound = describeAdoptFailure(error("NOT_FOUND"), tEn);
    expect(notFound.title).toBe("The task no longer exists. Nothing was adopted.");
    expect(describeAdoptFailure(error("CONFLICT"), tEn).detail).toBe("Backend reason");
    expect(describeAdoptFailure(error("UNMAPPED"), tEn).title).toBe("Adoption was refused");
    const success = describeAdoptSuccess(
      {
        label: "com.example.demo",
        backupId: "backup-1",
        effectNote: "Only ownership was recorded.",
      } as unknown as AdoptExecution,
      tEn,
    );
    expect(success.title).toBe("Adopted com.example.demo");
    expect(success.detail).toContain("backup-1");
    expect(CJK_PATTERN.test(JSON.stringify([notFound, success]))).toBe(false);
  });

  it("writes edit notices in English", () => {
    expect(describeEditFailure(error("CONFLICT"), tEn).title).toBe(
      "The configuration was changed outside this app after the preview. Nothing was saved.",
    );
    const restored = describeEditOutcome(
      { outcome: { status: "FAILED", fileState: "RESTORED" } } as never,
      tEn,
    );
    expect(restored.title).toBe("Saving did not finish");
    expect(restored.detail).toBe(
      "The write did not pass the check, so the original content was restored.",
    );
    const granted = grantNotice(
      { grantReleaseError: { message: "denied" } } as never,
      tEn,
    );
    expect(granted).toBe("The temporary permission could not be revoked automatically: denied");
  });

  it("hides secret values in English as well", () => {
    const state = {
      environment: [{ id: 1, key: "TOKEN", value: "s3cret-value" }],
    };
    expect(scrubSecrets("failed for s3cret-value", state, tEn)).toBe("failed for [hidden]");
  });
});
