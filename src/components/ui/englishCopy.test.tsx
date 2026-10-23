// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LocaleProvider } from "../../i18n/LocaleProvider";
import { CodeViewer } from "./CodeViewer";
import { LogViewer } from "./LogViewer";
import { PasteButton } from "./PasteButton";
import { SecretValue } from "./SecretValue";
import { TextAreaField } from "./forms";

const CJK_PATTERN = /[\u3000-\u303f\u3400-\u9fff\uf900-\ufaff\uff00-\uffef]/;

function renderInEnglish(ui: React.ReactElement) {
  return render(<LocaleProvider preference="en">{ui}</LocaleProvider>);
}

function expectNoCjk(text: string) {
  expect(CJK_PATTERN.test(text)).toBe(false);
}

describe("shared components in English", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders PasteButton copy and its failure notice in English", async () => {
    const { container } = renderInEnglish(<PasteButton onPaste={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Read clipboard" }));

    await waitFor(() =>
      expect(
        screen.getByText(
          "Could not read the clipboard. Paste with ⌘V in the input instead.",
        ),
      ).toBeTruthy(),
    );
    expectNoCjk(container.textContent ?? "");
  });

  it("renders CodeViewer toolbar copy in English without Chinese characters", () => {
    const { container } = renderInEnglish(
      <CodeViewer
        label="Parsed content"
        language="dotenv"
        text={'PORT=8080\nNAME="user home"\n'}
        title=".env"
      />,
    );

    expect(screen.getByRole("button", { name: "Wrap" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open in window" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Parsed content" })).toBeTruthy();
    expectNoCjk(container.textContent ?? "");
    expectNoCjk(
      container.querySelector("[aria-label]")?.getAttribute("aria-label") ?? "",
    );
  });

  it("renders a form field's expand control and dialog copy in English", () => {
    const { container } = renderInEnglish(
      <TextAreaField expandable label="Notes" onValueChange={() => {}} value="" />,
    );

    expect(
      screen.getByRole("button", { name: "Open Notes in a separate editor" }),
    ).toBeTruthy();
    expectNoCjk(container.textContent ?? "");
  });

  it("renders SecretValue controls in English", () => {
    const { container } = renderInEnglish(
      <SecretValue label="API_KEY" value="secret" />,
    );

    expect(
      screen.getByRole("button", { name: "Show the value of API_KEY" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy the value of API_KEY" })).toBeTruthy();
    expectNoCjk(container.textContent ?? "");
  });

  it("renders LogViewer copy and line counts in English", () => {
    const { container } = renderInEnglish(
      <LogViewer label="Caddy log" lines={["one"]} />,
    );

    expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
    expect(screen.getByText("1 line")).toBeTruthy();
    expect(screen.getByRole("log", { name: "Caddy log content" })).toBeTruthy();
    expectNoCjk(container.textContent ?? "");
  });

  it("renders LogViewer truncation and paused notices in English", () => {
    const { container } = renderInEnglish(
      <LogViewer droppedCount={3} label="Caddy log" lines={["one", "two"]} paused />,
    );

    expect(
      screen.getByText("Dropped 3 earlier lines and kept the latest 2."),
    ).toBeTruthy();
    expect(screen.getByText("Paused. The view stops updating.")).toBeTruthy();
    expectNoCjk(container.textContent ?? "");
  });
});
