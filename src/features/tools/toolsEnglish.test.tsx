import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "../../i18n/LocaleProvider";
import { CodecTool } from "./CodecTool";
import { JsonTool } from "./JsonTool";
import { QrTool } from "./QrTool";
import { ToolsPage } from "./ToolsPage";
import { XmlTool } from "./XmlTool";
import { inputProblem, iconLevelNotice } from "./qrToolState";
import { algorithmOptions, noticeText } from "./codecToolState";
import { oversizedView } from "./jsonToolState";

const CJK_PATTERN = /[㐀-鿿豈-﫿]/;

function renderEnglish(ui: React.ReactElement) {
  return renderToStaticMarkup(<LocaleProvider preference="en">{ui}</LocaleProvider>);
}

describe("tools in English", () => {
  it("renders the tool switcher and the JSON panel without Chinese text", () => {
    const html = renderEnglish(<ToolsPage />);

    expect(html).toContain("Encode and decode");
    expect(html).toContain("QR code");
    expect(html).toContain("The result appears here.");
    expect(html).toContain("Format");
    expect(CJK_PATTERN.test(html)).toBe(false);
  });

  it("renders the JSON panel in English", () => {
    const html = renderEnglish(<JsonTool />);

    expect(html).toContain("JSON formatting");
    expect(html).toContain("Output format");
    expect(html).toContain("Indent 2 spaces");
    expect(html).toContain("Output format");
    expect(html).toContain("Result");
    expect(CJK_PATTERN.test(html)).toBe(false);
  });

  it("renders the XML panel in English", () => {
    const html = renderEnglish(<XmlTool />);

    expect(html).toContain("XML formatting");
    expect(html).toContain("Whitespace in mixed content");
    expect(CJK_PATTERN.test(html)).toBe(false);
  });

  it("renders the codec panel in English with English algorithm and direction names", () => {
    const html = renderEnglish(<CodecTool />);

    expect(html).toContain("Text encoding and decoding");
    expect(html).toContain("Algorithm");
    expect(html).toContain("Base64 (UTF-8)");
    expect(html).toContain("Encode");
    expect(html).toContain("Clear input");
    expect(CJK_PATTERN.test(html)).toBe(false);
    const labels = algorithmOptions("en").map((option) => String(option.label));
    expect(labels).toContain("HTML entities");
    expect(labels).toContain("Unicode escapes");
    expect(labels.some((label) => CJK_PATTERN.test(label))).toBe(false);
  });

  it("renders the QR panel in English", () => {
    const html = renderEnglish(<QrTool />);

    expect(html).toContain("QR code generation");
    expect(html).toContain("Error correction");
    expect(html).toContain("Center icon (optional)");
    expect(html).toContain("Choose icon…");
    expect(html).toContain("Enter text to generate a QR code here.");
    expect(html).toContain("Export PNG…");
    expect(CJK_PATTERN.test(html)).toBe(false);
  });

  it("explains the input limit in English", () => {
    expect(inputProblem("a".repeat(2049), "M", "en")).toContain("2048");
    expect(inputProblem("a".repeat(2049), "M", "en")).not.toMatch(CJK_PATTERN);
    expect(iconLevelNotice("M", "icon-1", "en")).not.toMatch(CJK_PATTERN);
    const view = oversizedView("en");
    expect(view.status === "error" && view.message).toBe(
      "The input is over the 1 MiB limit, so it was not sent.",
    );
  });

  it("shows the known codec notice in English", () => {
    expect(noticeText("未识别的实体已保留。", "en")).toBe(
      "Unrecognized entities were kept as written.",
    );
    expect(noticeText("未识别的实体已保留。", "zh-CN")).toBe("未识别的实体已保留。");
  });
});
