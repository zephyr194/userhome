import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LocaleProvider } from "../../i18n/LocaleProvider";
import type { LanguagePreference } from "../../i18n";
import { EnvironmentPage } from "./EnvironmentPage";
import { EnvironmentView, type EnvironmentActions } from "./EnvironmentView";
import { LaunchctlView, type LaunchctlState } from "./LaunchctlView";
import { VariableChainList } from "./VariableChainTable";
import { ZshView, type ZshViewProps } from "./ZshView";
import { INITIAL_ZSH_STATE } from "./zshModel";
import { EMPTY_DIRECTORY } from "./dotenvDirectoryModel";

const CJK = /[㐀-鿿豈-﫿]/;

const NOOP_ACTIONS: EnvironmentActions = {
  addGrant: () => undefined,
  addVariable: () => undefined,
  editRow: () => undefined,
  loadValue: () => Promise.resolve(""),
  newFile: () => undefined,
  rescan: () => undefined,
  revokeGrant: () => undefined,
  reloadGrants: () => undefined,
  selectFile: () => undefined,
  setPatterns: () => undefined,
  setRecursive: () => undefined,
};

function inLocale(preference: LanguagePreference, node: ReactNode): string {
  return renderToStaticMarkup(<LocaleProvider preference={preference}>{node}</LocaleProvider>);
}

const LAUNCHCTL_READY: LaunchctlState = {
  status: "ready",
  environment: {
    entries: [
      { key: "PATH", value: "/usr/bin", secret: false },
      { key: "API_TOKEN", value: "x", secret: true },
    ],
    readAt: "2026-10-23T08:00:00Z",
    partial: false,
  },
};

describe("English rendering", () => {
  it("renders the environment page without Chinese text in English", () => {
    expect(CJK.test(inLocale("en", <EnvironmentPage />))).toBe(false);
  });

  it("renders the dotenv content in English, including the empty and error states", () => {
    const markup = inLocale(
      "en",
      <EnvironmentView
        actions={NOOP_ACTIONS}
        addingGrant={false}
        directory={EMPTY_DIRECTORY}
        grants={{ status: "ready", grants: [] }}
        patternsText="*.env"
        recursive={false}
      />,
    );
    expect(markup).toContain("Add directory");
    expect(CJK.test(markup)).toBe(false);
    expect(CJK.test(inLocale("en", <EnvironmentView actions={NOOP_ACTIONS} addingGrant={false} directory={EMPTY_DIRECTORY} grants={{ status: "loading" }} patternsText="*.env" recursive={false} />))).toBe(false);
  });

  it("renders the login session in English", () => {
    const markup = inLocale(
      "en",
      <LaunchctlView
        onPreview={() => Promise.reject(new Error("unused"))}
        onReveal={() => Promise.resolve("")}
        onRetry={() => undefined}
        onSet={() => Promise.reject(new Error("unused"))}
        onUnset={() => Promise.reject(new Error("unused"))}
        state={LAUNCHCTL_READY}
      />,
    );
    expect(markup).toContain("Login session environment variables");
    expect(CJK.test(markup)).toBe(false);
  });

  it("renders the zsh view while it reads, in English", () => {
    const props: ZshViewProps = {
      state: INITIAL_ZSH_STATE,
      choosing: false,
      onChooseDirectory: () => undefined,
      onClearDirectory: () => undefined,
      onLoadValue: () => Promise.resolve(""),
      onReload: () => undefined,
    };
    const markup = inLocale("en", <ZshView {...props} />);
    expect(markup).toContain("Reading zsh startup files");
    expect(CJK.test(markup)).toBe(false);
  });

  it("renders the merged cross-file rows and the search field in English", () => {
    const markup = inLocale(
      "en",
      <VariableChainList
        label="Variables"
        onRevealFinal={() => Promise.resolve("")}
        rows={[
          {
            name: "API_URL",
            final: { value: { kind: "text", text: "a" }, source: { file: "a.env", line: 1 } },
            chain: [
              { value: { kind: "text", text: "a" }, source: { file: "a.env", line: 1 } },
              { value: { kind: "text", text: "b" }, source: { file: "b.env", line: 2 } },
            ],
            definedIn: 2,
          },
        ]}
        searchKey="english-test"
      />,
    );
    expect(markup).toContain("Defined in 2 files");
    expect(markup).toContain("Search variables");
    expect(CJK.test(markup)).toBe(false);
  });
});
