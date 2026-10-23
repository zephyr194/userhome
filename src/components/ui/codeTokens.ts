export type CodeLanguage = "dotenv" | "shell" | "caddyfile" | "json" | "toml" | "ini" | "plain";

export type CodeTokenKind =
  | "comment"
  | "key"
  | "string"
  | "number"
  | "keyword"
  | "punct"
  | "variable"
  | "section";

export interface CodeToken {
  readonly kind?: CodeTokenKind;
  readonly text: string;
}

export type CodeLine = readonly CodeToken[];

export const HIGHLIGHT_MAX_BYTES = 200 * 1024;

const encoder = new TextEncoder();
const NUMBER = /^[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/;
const NAME = /^[A-Za-z_][\w.-]*$/;
const LITERALS = new Set(["true", "false", "null"]);
const SHELL_KEYWORDS = new Set([
  "export",
  "local",
  "typeset",
  "unset",
  "alias",
  "source",
  "function",
  "if",
  "then",
  "else",
  "elif",
  "fi",
  "for",
  "do",
  "done",
  "case",
  "esac",
  "while",
  "return",
]);

export function canHighlight(text: string): boolean {
  return text.length <= HIGHLIGHT_MAX_BYTES && encoder.encode(text).byteLength <= HIGHLIGHT_MAX_BYTES;
}

export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function tokenizeLines(text: string, language: CodeLanguage): CodeLine[] {
  const scan = createLineScanner(language);
  return splitLines(text).map(scan);
}

function createLineScanner(language: CodeLanguage): (line: string) => CodeToken[] {
  switch (language) {
    case "json": {
      const state = { inBlockComment: false };
      return (line) => scanJsonLine(line, state);
    }
    case "dotenv":
      return scanDotenvLine;
    case "shell":
      return scanShellLine;
    case "caddyfile":
      return scanCaddyLine;
    case "toml":
      return (line) => scanIniLine(line, "#");
    case "ini":
      return (line) => scanIniLine(line, "#;");
    case "plain":
      return (line) => (line === "" ? [] : [{ text: line }]);
  }
}

class TokenList {
  readonly tokens: CodeToken[] = [];

  add(text: string, kind?: CodeTokenKind): void {
    if (text === "") return;
    this.tokens.push(kind ? { kind, text } : { text });
  }
}

interface WordOptions {
  hashComments: boolean;
  variables: boolean;
  placeholders: boolean;
  assignments: boolean;
  classify: (word: string, index: number) => CodeTokenKind | undefined;
}

const isSpace = (ch: string): boolean => ch === " " || ch === "\t";
const isIdentChar = (ch: string): boolean => /[A-Za-z0-9_]/.test(ch);

function skipSpaces(line: string, from: number): number {
  let i = from;
  while (i < line.length && isSpace(line[i])) i++;
  return i;
}

function nextChar(line: string, from: number): string {
  return line[skipSpaces(line, from)] ?? "";
}

function quotedEnd(line: string, start: number): number {
  const quote = line[start];
  let i = start + 1;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "\\" && quote === '"') {
      i += 2;
      continue;
    }
    if (ch === quote) return i + 1;
    i++;
  }
  return line.length;
}

function variableEnd(line: string, start: number): number {
  let j = start + 1;
  if (line[j] === "{") {
    j++;
    while (j < line.length && isIdentChar(line[j])) j++;
    return line[j] === "}" ? j + 1 : j;
  }
  while (j < line.length && isIdentChar(line[j])) j++;
  return j;
}

function placeholderEnd(line: string, start: number): number {
  let j = start + 1;
  while (j < line.length && !isSpace(line[j]) && !"}{\"'".includes(line[j])) j++;
  return j > start + 1 && line[j] === "}" ? j + 1 : -1;
}

function isWordBoundary(ch: string, options: WordOptions): boolean {
  return (
    isSpace(ch) ||
    ch === '"' ||
    ch === "'" ||
    (options.variables && ch === "$")
  );
}

function scanWords(line: string, from: number, options: WordOptions, out: TokenList): void {
  let i = from;
  let index = 0;
  let previous = "";
  while (i < line.length) {
    const ch = line[i];
    if (isSpace(ch)) {
      const end = skipSpaces(line, i);
      out.add(line.slice(i, end));
      i = end;
      continue;
    }
    if (ch === "#" && options.hashComments && (i === from || isSpace(line[i - 1]))) {
      out.add(line.slice(i), "comment");
      return;
    }
    if (ch === '"' || ch === "'") {
      const end = quotedEnd(line, i);
      out.add(line.slice(i, end), "string");
      i = end;
      index++;
      continue;
    }
    if (ch === "$" && options.variables) {
      const end = variableEnd(line, i);
      out.add(line.slice(i, end), "variable");
      i = end;
      index++;
      continue;
    }
    if (ch === "{" && options.placeholders) {
      const end = placeholderEnd(line, i);
      if (end !== -1) {
        out.add(line.slice(i, end), "variable");
        i = end;
        index++;
        continue;
      }
    }
    let end = i + 1;
    while (end < line.length && !isWordBoundary(line[end], options)) end++;
    const word = line.slice(i, end);
    const eq = word.indexOf("=");
    const assignable = index === 0 || (index === 1 && previous === "export");
    if (options.assignments && assignable && eq > 0 && NAME.test(word.slice(0, eq))) {
      out.add(word.slice(0, eq), "key");
      out.add("=", "punct");
      i += eq + 1;
      previous = "";
      index++;
      continue;
    }
    out.add(word, word === "{" || word === "}" ? "punct" : options.classify(word, index));
    previous = word;
    i = end;
    index++;
  }
}

function literalKind(word: string): CodeTokenKind | undefined {
  if (LITERALS.has(word)) return "keyword";
  if (NUMBER.test(word)) return "number";
  return undefined;
}

const DOTENV_OPTIONS: WordOptions = {
  hashComments: true,
  variables: true,
  placeholders: false,
  assignments: true,
  classify: (word, index) => (word === "export" && index === 0 ? "keyword" : literalKind(word)),
};

const SHELL_OPTIONS: WordOptions = {
  hashComments: true,
  variables: true,
  placeholders: false,
  assignments: true,
  classify: (word) => (SHELL_KEYWORDS.has(word) ? "keyword" : literalKind(word)),
};

function scanDotenvLine(line: string): CodeToken[] {
  return scanCommandLikeLine(line, DOTENV_OPTIONS);
}

function scanShellLine(line: string): CodeToken[] {
  return scanCommandLikeLine(line, SHELL_OPTIONS);
}

function scanCommandLikeLine(line: string, options: WordOptions): CodeToken[] {
  const out = new TokenList();
  const start = skipSpaces(line, 0);
  out.add(line.slice(0, start));
  if (start < line.length) scanWords(line, start, options, out);
  return out.tokens;
}

function scanCaddyLine(line: string): CodeToken[] {
  const out = new TokenList();
  const start = skipSpaces(line, 0);
  out.add(line.slice(0, start));
  if (start === line.length) return out.tokens;
  const indented = start > 0;
  scanWords(
    line,
    start,
    {
      hashComments: true,
      variables: false,
      placeholders: true,
      assignments: false,
      classify: (word, index) => {
        if (!indented) return "section";
        if (index === 0) return "keyword";
        return literalKind(word);
      },
    },
    out,
  );
  return out.tokens;
}

function scanIniLine(line: string, commentChars: string): CodeToken[] {
  const out = new TokenList();
  const start = skipSpaces(line, 0);
  out.add(line.slice(0, start));
  if (start === line.length) return out.tokens;
  const first = line[start];
  if (commentChars.includes(first)) {
    out.add(line.slice(start), "comment");
    return out.tokens;
  }
  if (first === "[") {
    out.add(line.slice(start), "section");
    return out.tokens;
  }
  const eq = line.indexOf("=", start);
  if (eq === -1) {
    out.add(line.slice(start));
    return out.tokens;
  }
  let keyEnd = eq;
  while (keyEnd > start && isSpace(line[keyEnd - 1])) keyEnd--;
  out.add(line.slice(start, keyEnd), "key");
  out.add(line.slice(keyEnd, eq));
  out.add("=", "punct");
  scanWords(
    line,
    eq + 1,
    {
      hashComments: true,
      variables: false,
      placeholders: false,
      assignments: false,
      classify: (word) => literalKind(word),
    },
    out,
  );
  return out.tokens;
}

const JSON_PUNCT = "{}[],:";

function isJsonBoundary(ch: string): boolean {
  return isSpace(ch) || ch === '"' || ch === "/" || JSON_PUNCT.includes(ch);
}

function scanJsonLine(line: string, state: { inBlockComment: boolean }): CodeToken[] {
  const out = new TokenList();
  let i = 0;
  if (state.inBlockComment) {
    const end = line.indexOf("*/");
    if (end === -1) {
      out.add(line, "comment");
      return out.tokens;
    }
    out.add(line.slice(0, end + 2), "comment");
    i = end + 2;
    state.inBlockComment = false;
  }
  while (i < line.length) {
    const ch = line[i];
    if (isSpace(ch)) {
      const end = skipSpaces(line, i);
      out.add(line.slice(i, end));
      i = end;
    } else if (ch === '"') {
      const end = quotedEnd(line, i);
      out.add(line.slice(i, end), nextChar(line, end) === ":" ? "key" : "string");
      i = end;
    } else if (ch === "/" && line[i + 1] === "/") {
      out.add(line.slice(i), "comment");
      break;
    } else if (ch === "/" && line[i + 1] === "*") {
      const end = line.indexOf("*/", i + 2);
      if (end === -1) {
        out.add(line.slice(i), "comment");
        state.inBlockComment = true;
        break;
      }
      out.add(line.slice(i, end + 2), "comment");
      i = end + 2;
    } else if (JSON_PUNCT.includes(ch)) {
      out.add(ch, "punct");
      i++;
    } else {
      let end = i + 1;
      while (end < line.length && !isJsonBoundary(line[end])) end++;
      const word = line.slice(i, end);
      out.add(word, literalKind(word));
      i = end;
    }
  }
  return out.tokens;
}
