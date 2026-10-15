import { describe, expect, it } from "vitest";
import {
  INITIAL_SECRET_VIEW_STATE,
  SECRET_MASK,
  secretViewReducer,
} from "./secretMask";

describe("secret view state", () => {
  it("starts masked with no copy feedback", () => {
    expect(INITIAL_SECRET_VIEW_STATE).toEqual({
      revealed: false,
      copy: "idle",
    });
  });

  it("reveals and hides explicitly", () => {
    const shown = secretViewReducer(INITIAL_SECRET_VIEW_STATE, "reveal");
    expect(shown.revealed).toBe(true);
    expect(secretViewReducer(shown, "hide").revealed).toBe(false);
  });

  it("toggle flips the mask and clears copy feedback", () => {
    const copied = secretViewReducer(INITIAL_SECRET_VIEW_STATE, "copied");
    const shown = secretViewReducer(copied, "toggle");
    expect(shown).toEqual({ revealed: true, copy: "idle" });
    expect(secretViewReducer(shown, "toggle").revealed).toBe(false);
  });

  it("copying does not reveal the value", () => {
    const copied = secretViewReducer(INITIAL_SECRET_VIEW_STATE, "copied");
    expect(copied).toEqual({ revealed: false, copy: "copied" });
    expect(secretViewReducer(copied, "copyFailed").copy).toBe("failed");
  });

  it("hiding when the user leaves clears copy feedback too", () => {
    const state = secretViewReducer(
      secretViewReducer(INITIAL_SECRET_VIEW_STATE, "reveal"),
      "copied",
    );
    expect(secretViewReducer(state, "hide")).toEqual(INITIAL_SECRET_VIEW_STATE);
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
