import { clearMocks } from "@tauri-apps/api/mocks";
import { afterEach, beforeEach, vi } from "vitest";

beforeEach(() => {
  vi.stubGlobal("window", globalThis);
});

afterEach(() => {
  clearMocks();
  vi.unstubAllGlobals();
});
