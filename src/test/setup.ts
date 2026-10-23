import { clearMocks } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, vi } from "vitest";

const originalNavigator = globalThis.navigator;

beforeEach(() => {
  vi.stubGlobal("window", globalThis);
  Object.defineProperty(originalNavigator, "language", {
    configurable: true,
    value: "zh-CN",
  });
});

afterEach(() => {
  clearMocks();
  vi.unstubAllGlobals();
  delete (originalNavigator as { language?: string }).language;
});
