import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LaunchdOwnership, LaunchdService } from "../../ipc/services";
import {
  APPLE_OWNERSHIP,
  CREATED_OWNERSHIP,
  DAEMON_OWNERSHIP,
  THIRD_PARTY_OWNERSHIP,
  configFile,
  launchdService,
  ownership,
  sampleDiscovery,
} from "./launchdFixtures";
import { ServiceManagement } from "./ServiceManagement";
import { ServicesView, type ServicesViewProps } from "./ServicesView";
import { EMPTY_FILTER, type DiscoveryState } from "./launchdModel";

const ALLOWED = ["接管", "编辑", "取消接管"];

const ADOPTED: LaunchdOwnership = ownership({
  kind: "USERHOME_ADOPTED",
  modifiable: true,
  readOnlyReasons: [],
  evidence: ["ADOPTION_RECORD", "DOMAIN_GUI", "OWNER_CURRENT_USER", "REGULAR_FILE"],
});

function plainDetails() {
  return {
    programArguments: ["/usr/local/bin/tool", "--serve"],
    argumentsTruncated: false,
    environmentKeys: ["MODE"],
    runAtLoad: false,
    keepAlive: { mode: "NEVER" as const, conditions: [] },
  };
}

function adoptedJob(overrides: Partial<LaunchdService> = {}): LaunchdService {
  return launchdService({
    ownership: ADOPTED,
    configFiles: [configFile({ details: plainDetails() })],
    ...overrides,
  });
}

function management(service: LaunchdService): string {
  return renderToStaticMarkup(<ServiceManagement onChanged={() => undefined} service={service} />);
}

function buttonLabels(markup: string): string[] {
  return [...markup.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((match) =>
    match[1].replace(/<[^>]+>/g, "").trim(),
  );
}

describe("adoption entry on a current user's job", () => {
  it("offers the adopt button for a job that may be adopted", () => {
    const markup = management(launchdService());
    expect(markup).toContain("接管与编辑");
    expect(buttonLabels(markup)).toEqual(["接管"]);
    expect(markup).toContain("不修改 plist");
  });

  it("shows the reasons, and no button, for a job that may not be adopted", () => {
    const markup = management(
      launchdService({
        ownership: ownership({
          readOnlyReasons: ["NOT_ADOPTED", "SYMBOLIC_LINK"],
          evidence: ["SYMBOLIC_LINK"],
        }),
      }),
    );
    expect(markup).toContain("这个任务不能接管");
    expect(markup).toContain("符号链接");
    expect(buttonLabels(markup)).toEqual([]);
  });
});

describe("entries on an adopted job", () => {
  it("offers edit and release when the verdict allows an edit", () => {
    const markup = management(adoptedJob());
    expect(markup).toContain("已由 UserHome 接管");
    expect(buttonLabels(markup)).toEqual(["编辑", "取消接管"]);
  });

  it("keeps release but withholds edit, with the reason, when the job cannot be edited", () => {
    const markup = management(
      adoptedJob({
        configFiles: [
          configFile({
            details: { ...plainDetails(), programArguments: [], program: "/bin/x" },
          }),
        ],
      }),
    );
    expect(markup).toContain("这个任务当前不能编辑");
    expect(markup).toContain("Program");
    expect(buttonLabels(markup)).toEqual(["取消接管"]);
  });

});

describe("classes that get no adoption or edit entry", () => {
  it.each([
    ["Apple", launchdService({ ownership: APPLE_OWNERSHIP })],
    ["system daemon", launchdService({ ownership: DAEMON_OWNERSHIP })],
    ["third party", launchdService({ ownership: THIRD_PARTY_OWNERSHIP })],
    ["UserHome created", launchdService({ ownership: CREATED_OWNERSHIP })],
  ])("renders nothing for a %s job", (_name, service) => {
    expect(management(service)).toBe("");
  });
});

describe("the entries stay on the allow list", () => {
  it("never offers a delete, batch, system or load action in this panel", () => {
    for (const service of [launchdService(), adoptedJob()]) {
      const labels = buttonLabels(management(service));
      for (const label of labels) {
        expect(ALLOWED).toContain(label);
      }
    }
  });
});

describe("the page slot", () => {
  it("renders the management panel only when the page supplies it", () => {
    const state: DiscoveryState = {
      status: "ready",
      discovery: sampleDiscovery({ services: [launchdService()] }),
      refreshing: false,
    };
    const props: ServicesViewProps = {
      state,
      evidence: { status: "ready", summaries: [] },
      filter: EMPTY_FILTER,
      selectedId: "gui/501/com.example.agent",
      refreshDisabled: false,
      onFilterChange: () => undefined,
      onSelect: () => undefined,
      onRefresh: () => undefined,
    };
    expect(renderToStaticMarkup(<ServicesView {...props} />)).not.toContain("接管与编辑");
    const withSlot = renderToStaticMarkup(
      <ServicesView
        {...props}
        renderManagement={(service) => (
          <ServiceManagement onChanged={() => undefined} service={service} />
        )}
      />,
    );
    expect(withSlot).toContain("接管与编辑");
    expect(buttonLabels(withSlot).filter((label) => label === "接管")).toEqual(["接管"]);
  });
});
