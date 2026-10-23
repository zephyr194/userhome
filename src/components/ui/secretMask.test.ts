import { describe, expect, it } from "vitest";
import {
  INITIAL_SECRET_VIEW_STATE,
  SECRET_MASK,
  secretViewReducer,
} from "./secretMask";

describe("secret view state", () => {
  it("starts masked", () => {
    expect(INITIAL_SECRET_VIEW_STATE).toEqual({ revealed: false });
  });

  it("reveals and hides explicitly", () => {
    const shown = secretViewReducer(INITIAL_SECRET_VIEW_STATE, "reveal");
    expect(shown.revealed).toBe(true);
    expect(secretViewReducer(shown, "hide").revealed).toBe(false);
  });

  it("toggle flips the mask", () => {
    const shown = secretViewReducer(INITIAL_SECRET_VIEW_STATE, "toggle");
    expect(shown).toEqual({ revealed: true });
    expect(secretViewReducer(shown, "toggle").revealed).toBe(false);
  });

  it("hide on an already masked state returns the same object", () => {
    expect(secretViewReducer(INITIAL_SECRET_VIEW_STATE, "hide")).toBe(
      INITIAL_SECRET_VIEW_STATE,
    );
  });

  it("uses a fixed mask that does not depend on the value", () => {
    expect(SECRET_MASK).toMatch(/^•+$/);
  });
});
