// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import corpusJson from "../../../src-tauri/tests/fixtures/redaction_corpus.json";
import { SecretValue } from "./SecretValue";
import { SECRET_MASK } from "./secretMask";

/**
 * 脱敏对抗性样例集（INC-0011 / S11，提案 P1）：Rust 各脱敏器与这里读同一份 JSON。
 * 本文件只跑 `secret_mask` 目标，并校验样例集本身的结构。
 */
type Target =
  | "config_view"
  | "caddy_redact"
  | "config_redaction"
  | "secret_mask";

interface CorpusCase {
  id: string;
  kind: "positive" | "negative";
  targets: Target[];
  input: string;
  must_not_contain: string[];
  must_contain?: string[];
  note: string;
  known_gap?: boolean;
  tls?: { certificate: string; private_key: string }[];
  chunks?: string[];
  chunk_bytes?: number;
}

const cases = (corpusJson as unknown as { cases: CorpusCase[] }).cases;
const TARGETS: Target[] = [
  "config_view",
  "caddy_redact",
  "config_redaction",
  "secret_mask",
];

function casesFor(target: Target): CorpusCase[] {
  return cases.filter((item) => item.targets.includes(target));
}

/** 已知缺口：不在这里断言，但要打印说明，避免被悄悄忘掉。 */
function runnableCasesFor(target: Target): CorpusCase[] {
  return casesFor(target).filter((item) => {
    if (!item.known_gap) return true;
    console.info(`redaction corpus: skipping known gap ${item.id}: ${item.note}`);
    return false;
  });
}

afterEach(cleanup);

describe("redaction corpus structure", () => {
  it("has unique ids and only known targets", () => {
    const ids = cases.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of cases) {
      expect(item.targets.length).toBeGreaterThan(0);
      for (const target of item.targets) expect(TARGETS).toContain(target);
      expect(item.note).not.toBe("");
    }
  });

  it("positive cases leak-check strings that really occur in the input", () => {
    for (const item of cases.filter(
      (entry) =>
        entry.kind === "positive" && !entry.targets.includes("config_redaction"),
    )) {
      expect(item.must_not_contain.length, item.id).toBeGreaterThan(0);
      for (const needle of item.must_not_contain) {
        expect(item.input, `${item.id}: ${needle}`).toContain(needle);
      }
    }
  });

  it("negative cases forbid nothing, so they can only fail by changing the input", () => {
    for (const item of cases.filter((entry) => entry.kind === "negative")) {
      expect(item.must_not_contain, item.id).toEqual([]);
    }
  });

  it("stream chunks add up to the input", () => {
    for (const item of cases.filter((entry) => entry.chunks)) {
      expect((item.chunks ?? []).join(""), item.id).toBe(item.input);
    }
  });

  it("covers every target with positives, and every text redactor with negatives", () => {
    for (const target of TARGETS) {
      const own = casesFor(target);
      expect(own.some((item) => item.kind === "positive"), target).toBe(true);
      if (target !== "secret_mask") {
        expect(own.some((item) => item.kind === "negative"), target).toBe(true);
      }
    }
  });

  it("lists known gaps explicitly so they are not mistaken for passing cases", () => {
    for (const item of cases.filter((entry) => entry.known_gap)) {
      expect(item.kind, item.id).toBe("positive");
    }
  });
});

describe("SecretValue against the redaction corpus", () => {
  const secretCases = runnableCasesFor("secret_mask");

  it("has secret_mask cases to run", () => {
    expect(secretCases.length).toBeGreaterThan(0);
  });

  it.each(secretCases.map((item) => [item.id, item] as const))(
    "%s: masked by default, plaintext absent from markup and text",
    (_id, item) => {
      const markup = renderToStaticMarkup(
        <SecretValue label="OPENAI_API_KEY" value={item.input} />,
      );
      expect(markup).toContain(SECRET_MASK);
      expect(markup).toContain('data-secret-state="masked"');
      for (const needle of item.must_not_contain) {
        expect(markup).not.toContain(needle);
      }

      const { container } = render(
        <SecretValue label="OPENAI_API_KEY" value={item.input} />,
      );
      const text = container.textContent ?? "";
      const html = container.innerHTML;
      for (const needle of item.must_not_contain) {
        expect(text).not.toContain(needle);
        expect(html).not.toContain(needle);
      }
    },
  );

  it.each(secretCases.map((item) => [item.id, item] as const))(
    "%s: revealing on request shows the value, so the masked check is not vacuous",
    (_id, item) => {
      const { container } = render(
        <SecretValue label="OPENAI_API_KEY" value={item.input} />,
      );
      const toggle = container.querySelector("button");
      expect(toggle).not.toBeNull();
      fireEvent.click(toggle as HTMLButtonElement);

      expect(container.querySelector("code")?.textContent).toBe(item.input);
    },
  );

  it("renders the same masked text whatever the value or its length", () => {
    const maskedTexts = new Set(
      secretCases.map((item) => {
        const { container, unmount } = render(
          <SecretValue label="K" value={item.input} />,
        );
        const text = container.querySelector("code")?.textContent;
        unmount();
        return text;
      }),
    );

    expect(maskedTexts.size).toBe(1);
  });
});
