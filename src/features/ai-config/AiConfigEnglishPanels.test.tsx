import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "../../i18n/LocaleProvider";
import type { ClaudeOptionItem, ClaudeOptionSummary } from "../../ipc/aiConfig";
import type {
  ReferenceSetting,
  ToolReference as ToolReferenceData,
} from "../../ipc/aiConfigReference";
import { ClaudeSettingsView } from "./ToolSettings";
import { CommandBuilderView } from "./CommandBuilder";
import { EditPanel } from "./SettingEditor";
import { ToolReferenceView } from "./ToolReference";

const CJK_PATTERN = /[\u3000-\u303f\u3400-\u9fff\uf900-\uffef]/;
const CODEX_PLACEHOLDER = "schema 未提供描述（未核实）";
const SOURCE_URL = "https://example.com/reference";

function renderInEnglish(element: React.ReactElement): string {
  return renderToStaticMarkup(<LocaleProvider preference="en">{element}</LocaleProvider>);
}

function expectNoCjk(markup: string): void {
  expect(CJK_PATTERN.test(markup)).toBe(false);
}

function setting(overrides: Partial<ReferenceSetting> = {}): ReferenceSetting {
  return {
    id: "setting-1",
    keyPath: "general.preferredEditor",
    valueType: "enum",
    allowedValues: ["vim", "emacs"],
    description: "Preferred editor for opening files.",
    descriptionTruncated: false,
    defaultNote: "Not set",
    defaultNoteTruncated: false,
    coverage: "displayOnly",
    risks: ["executesCommand"],
    secret: false,
    sourceUrl: SOURCE_URL,
    ...overrides,
  };
}

function reference(): ToolReferenceData {
  return {
    toolId: "codex-cli",
    displayName: "Codex CLI",
    source: { url: SOURCE_URL, retrievedOn: "2026-10-22", documentedVersion: "unknown" },
    notices: ["Check the official page before relying on this list."],
    resources: [
      {
        id: "codex-user-config",
        layer: "userLevel",
        format: "toml",
        location: "{home}/.codex/config.toml",
        coverage: "versionUnknown",
        description: "User configuration file.",
        descriptionTruncated: false,
        metadataOnly: false,
        sourceUrl: SOURCE_URL,
      },
    ],
    settings: [
      setting(),
      setting({
        id: "setting-2",
        keyPath: "browser_use",
        valueType: "boolean",
        allowedValues: [],
        description: CODEX_PLACEHOLDER,
        defaultNote: "Not set",
        risks: [],
      }),
    ],
    flagsCoverage: {
      snapshotComplete: false,
      coverageNote: "Flags are not checked one by one.",
      coverageNoteTruncated: false,
      sourceUrl: SOURCE_URL,
    },
    envCoverage: {
      snapshotComplete: false,
      coverageNote: null,
      coverageNoteTruncated: false,
      sourceUrl: SOURCE_URL,
    },
  };
}

function option(overrides: Partial<ClaudeOptionItem> = {}): ClaudeOptionItem {
  return {
    id: "--model",
    kind: "flag",
    valueType: "string",
    allowedValues: [],
    description: "Set the model for the session.",
    generatable: true,
    secret: false,
    singleInvocation: true,
    excludes: [],
    requires: [],
    risks: [],
    versions: null,
    configAlternative: null,
    ...overrides,
  };
}

const SUMMARY: ClaudeOptionSummary = {
  coverageNote: "Coverage: verified subset only.",
  flagsCoverage: null,
  envCoverage: null,
  items: [
    option({
      id: "--dangerously-skip-permissions",
      valueType: "boolean",
      risks: ["relaxesPermissions"],
      excludes: ["--print"],
      versions: { min: "2.1.248", max: "unknown" },
    }),
    option({
      id: "ANTHROPIC_API_KEY",
      kind: "env",
      secret: true,
      singleInvocation: null,
      description: "API key.",
    }),
  ],
};

describe("AI tool panels in English", () => {
  it("renders the official settings reference without Chinese text of its own", () => {
    const markup = renderInEnglish(
      <ToolReferenceView state={{ status: "ready", reference: reference() }} onRetry={() => undefined} />,
    );

    expect(markup).toContain("Official settings reference");
    expect(markup).toContain("The schema gives no description for this setting, so it has not been verified.");
    expect(markup).toContain("Show only keys with risks or secrets");
    expectNoCjk(markup);
  });

  it("renders the command builder with English copy and placeholders", () => {
    const markup = renderInEnglish(
      <CommandBuilderView
        options={{ status: "ready", summary: SUMMARY }}
        selection={{}}
        detectedVersion=""
        preview={{ status: "idle", message: "Select a flag or environment variable to generate a command." }}
        copyMessage={null}
        onToggle={() => undefined}
        onValueChange={() => undefined}
        onAcknowledge={() => undefined}
        onVersionChange={() => undefined}
        onCopy={() => undefined}
        onRetry={() => undefined}
      />,
    );

    expect(markup).toContain("Claude Code command builder");
    expect(markup).toContain("Command-line flag");
    expect(markup).toContain("Cannot be used with");
    expectNoCjk(markup);
  });

  it("renders the Claude settings header and loading state in English", () => {
    const markup = renderInEnglish(
      <ClaudeSettingsView
        state={{ status: "loading" }}
        snapshot={null}
        projectGrant={null}
        selection={{ status: "idle" }}
        onChooseProject={() => undefined}
        onClearProject={() => undefined}
        onRetry={() => undefined}
      />,
    );

    expect(markup).toContain("Claude Code settings");
    expect(markup).toContain("Reading Claude Code settings…");
    expect(markup).toContain("None selected (only user and managed settings are read)");
    expectNoCjk(markup);
  });

  it("renders the settings editor entry point in English", () => {
    const markup = renderInEnglish(
      <EditPanel
        catalog={null}
        settingsFile={null}
        choosing={false}
        chooseError={null}
        onChooseSettingsFile={() => undefined}
        onSaved={() => undefined}
      />,
    );

    expect(markup).toContain("Edit (user settings file)");
    expect(markup).toContain("Editing details are not available.");
    expectNoCjk(markup);
  });
});
