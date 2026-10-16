import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ZshFile, ZshFileKey, ZshOrderStep, ZshOverview } from "../../ipc/environment";
import { ZshView } from "./ZshView";
import { INITIAL_ZSH_STATE, type ZshState } from "./zshModel";

const ORDER: ZshOrderStep[] = [
  { position: 1, scope: "SYSTEM", pathLabel: "/etc/zshenv", appliesTo: "ALL", readByUserHome: false },
  { position: 2, scope: "USER", pathLabel: "~/.zshenv", appliesTo: "ALL", file: "ZSHENV", readByUserHome: true },
  { position: 3, scope: "SYSTEM", pathLabel: "/etc/zprofile", appliesTo: "LOGIN", readByUserHome: false },
  { position: 4, scope: "USER", pathLabel: "~/.zprofile", appliesTo: "LOGIN", file: "ZPROFILE", readByUserHome: true },
  { position: 5, scope: "SYSTEM", pathLabel: "/etc/zshrc", appliesTo: "INTERACTIVE", readByUserHome: false },
  { position: 6, scope: "USER", pathLabel: "~/.zshrc", appliesTo: "INTERACTIVE", file: "ZSHRC", readByUserHome: true },
  { position: 7, scope: "SYSTEM", pathLabel: "/etc/zlogin", appliesTo: "LOGIN", readByUserHome: false },
  { position: 8, scope: "USER", pathLabel: "~/.zlogin", appliesTo: "LOGIN", file: "ZLOGIN", readByUserHome: true },
];
const NAMES = { ZSHENV: ".zshenv", ZPROFILE: ".zprofile", ZSHRC: ".zshrc", ZLOGIN: ".zlogin" } as const;
const APPLIES = { ZSHENV: "ALL", ZPROFILE: "LOGIN", ZSHRC: "INTERACTIVE", ZLOGIN: "LOGIN" } as const;
const POSITIONS = { ZSHENV: 2, ZPROFILE: 4, ZSHRC: 6, ZLOGIN: 8 } as const;

const READY: ZshFile["outcome"] = {
  status: "READY",
  contentHash: "a".repeat(64),
  sizeBytes: 10,
  lineCount: 0,
  rows: [],
  rowsTruncated: false,
  entryCount: 0,
  secretCount: 0,
  dynamicCount: 0,
  unrecognizedCount: 0,
};

function file(key: ZshFileKey, outcome: ZshFile["outcome"]): ZshFile {
  return {
    file: key,
    name: NAMES[key],
    appliesTo: APPLIES[key],
    position: POSITIONS[key],
    ...(outcome.status === "NOT_LOCATED" ? {} : { displayPath: `~/${NAMES[key]}` }),
    outcome,
  };
}

function state(files: ZshFile[]): ZshState {
  const overview: ZshOverview = {
    source: { url: "https://zsh.sourceforge.io/Doc/Release/Files.html", consultedOn: "2026-10-15" },
    order: ORDER,
    zdotdir: { status: "DEFAULT" },
    files,
  };
  return { ...INITIAL_ZSH_STATE, load: { status: "ready", requestId: 1, overview } };
}

const FILES = [
  file("ZSHENV", READY),
  file("ZPROFILE", { status: "UNAVAILABLE", reason: "NOT_FOUND", message: "文件不存在或已被移动。" }),
  file("ZSHRC", READY),
  file("ZLOGIN", { status: "OUTSIDE_HOME", message: "越界，未读取、未跟随。" }),
];

function render(onEditFile?: (file: ZshFileKey) => void, files: ZshFile[] = FILES) {
  return renderToStaticMarkup(
    <ZshView
      choosing={false}
      onChooseDirectory={() => undefined}
      onClearDirectory={() => undefined}
      onEditFile={onEditFile}
      onLoadValue={() => Promise.resolve("never")}
      onReload={() => undefined}
      state={state(files)}
    />,
  );
}

describe("zsh view edit entry points", () => {
  it("stays read only unless an editor is wired in", () => {
    const markup = render();
    expect(markup).not.toContain("编辑专用块");
    expect(markup).not.toContain("UserHome 专用块");
    expect(markup).not.toMatch(/<(input|textarea|select)\b/);
  });

  it("offers an entry per readable or missing file and none for out-of-reach ones", () => {
    const markup = render(vi.fn());
    expect(markup).toContain('aria-label="编辑 .zshenv 的 UserHome 专用块"');
    expect(markup).toContain('aria-label="编辑 .zprofile 的 UserHome 专用块"');
    expect(markup).toContain('aria-label="编辑 .zshrc 的 UserHome 专用块"');
    expect(markup).not.toContain('aria-label="编辑 .zlogin 的 UserHome 专用块"');
    expect(markup.match(/编辑专用块…/g)).toHaveLength(3);
  });

  it("makes .zshrc the default and says the others are chosen one at a time", () => {
    const markup = render(vi.fn());
    expect(markup.match(/默认只在 \.zshrc 里编辑/g)).toHaveLength(2);
    // The primary button belongs to .zshrc.
    expect(markup).toMatch(/bg-primary[^>]*aria-label="编辑 \.zshrc 的 UserHome 专用块"|aria-label="编辑 \.zshrc 的 UserHome 专用块"[^>]*bg-primary/);
    expect(markup).not.toMatch(/bg-primary[^>]*aria-label="编辑 \.zshenv/);
  });

  it("offers no entry while the location is unknown", () => {
    const markup = render(vi.fn(), [
      file("ZSHENV", READY),
      file("ZPROFILE", { status: "NOT_LOCATED", message: "ZDOTDIR 未确定，位置未知，未读取。" }),
    ]);
    expect(markup).toContain('aria-label="编辑 .zshenv 的 UserHome 专用块"');
    expect(markup).not.toContain('aria-label="编辑 .zprofile');
  });
});
