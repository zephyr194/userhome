import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import { StrictMode, type ReactElement } from "react";

/**
 * Testing Library's `render` inside `<StrictMode>`, so the test sees what the
 * development app sees: every effect runs, is cleaned up and runs again. A page
 * that starts a backend read on mount must still show the list and must not
 * start a second conflicting read. A `wrapper` option wraps StrictMode from the
 * outside.
 */
export function renderStrict(
  ui: ReactElement,
  options: Omit<RenderOptions, "queries"> = {},
): RenderResult {
  return render(<StrictMode>{ui}</StrictMode>, options);
}
