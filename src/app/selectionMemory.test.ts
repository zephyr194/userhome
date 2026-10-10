import { describe, expect, it } from "vitest";
import type { SelectionMemory } from "./selectionMemory";
import {
  DEFAULT_SELECTION_MEMORY,
  decodeSelectionMemory,
  encodeSelectionMemory,
} from "./selectionMemory";

describe("selection memory applications scope", () => {
  it("defaults to the local recognized scope", () => {
    expect(DEFAULT_SELECTION_MEMORY.applicationsScope).toBe(
      "LOCAL_RECOGNIZED",
    );
    expect(decodeSelectionMemory({}).applicationsScope).toBe(
      "LOCAL_RECOGNIZED",
    );
  });

  it("round-trips a persisted catalog scope", () => {
    const encoded = encodeSelectionMemory({
      ...DEFAULT_SELECTION_MEMORY,
      applicationsScope: "CATALOG",
    });

    expect(JSON.parse(encoded).applicationsScope).toBe("CATALOG");
    expect(
      decodeSelectionMemory(JSON.parse(encoded)).applicationsScope,
    ).toBe("CATALOG");
  });

  it("falls back to the local scope for an invalid stored scope", () => {
    expect(
      decodeSelectionMemory({ applicationsScope: "WAREHOUSE" })
        .applicationsScope,
    ).toBe("LOCAL_RECOGNIZED");
    expect(
      decodeSelectionMemory({ applicationsScope: 7 }).applicationsScope,
    ).toBe("LOCAL_RECOGNIZED");
  });

  it("never serializes transient candidate navigation fields", () => {
    const encoded = encodeSelectionMemory({
      ...DEFAULT_SELECTION_MEMORY,
      applicationsScope: "LOCAL_RECOGNIZED",
      candidateId: "candidate-42",
      sourceRefreshId: "refresh-42",
    } as SelectionMemory);

    expect(encoded).toContain("applicationsScope");
    expect(encoded).not.toContain("candidateId");
    expect(encoded).not.toContain("sourceRefreshId");
    expect(encoded).not.toContain("candidate-42");
    expect(encoded).not.toContain("refresh-42");
  });
});
