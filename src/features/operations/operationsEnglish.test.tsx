import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "../../i18n/LocaleProvider";
import type { OperationDetails, OperationSummary } from "../../ipc/operations";
import { OperationHistory } from "./OperationHistory";
import { OperationStatus } from "./OperationStatus";

const CJK_PATTERN = /[㐀-鿿豈-﫿]/;

function renderEnglish(ui: React.ReactElement) {
  return renderToStaticMarkup(<LocaleProvider preference="en">{ui}</LocaleProvider>);
}

function details(overrides: Partial<OperationDetails>): OperationDetails {
  return {
    operationId: "op-1",
    summary: "Stop fixture service",
    effects: [],
    expiresAt: "2026-09-20T09:05:00Z",
    status: "RUNNING",
    events: [],
    ...overrides,
  };
}

describe("operations in English", () => {
  it("renders the cancelling state without Chinese text", () => {
    const html = renderEnglish(
      <OperationStatus state={{ status: "ready", operation: details({ status: "CANCELLING" }) }} />,
    );

    expect(html).toContain("Stopping");
    expect(html).toContain("Recent operation");
    expect(html).toContain("It is not shown as stopped until then.");
    expect(CJK_PATTERN.test(html)).toBe(false);
  });

  it("renders loading, error, and empty states in English", () => {
    const loading = renderEnglish(<OperationStatus state={{ status: "loading" }} />);
    const empty = renderEnglish(<OperationStatus state={{ status: "empty" }} />);

    expect(loading).toContain("Reading the operation history…");
    expect(empty).toContain("No operations yet.");
    expect(CJK_PATTERN.test(loading + empty)).toBe(false);
  });

  it("renders the history list, its default title, and the item count in English", () => {
    const operations: OperationSummary[] = [
      { operationId: "a", summary: "Stop service", status: "SUCCEEDED" } as OperationSummary,
    ];
    const html = renderEnglish(<OperationHistory operations={operations} />);

    expect(html).toContain("Configuration history");
    expect(html).toContain("Operation log");
    expect(html).toContain("1 item");
    expect(html).toContain("Completed");
    expect(CJK_PATTERN.test(html)).toBe(false);
  });

  it("renders the empty history message in English", () => {
    const html = renderEnglish(<OperationHistory operations={[]} />);

    expect(html).toContain("No configuration operations yet.");
    expect(CJK_PATTERN.test(html)).toBe(false);
  });
});
