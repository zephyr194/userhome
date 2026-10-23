// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configFile, launchdService, sampleDiscovery, sampleServices } from "./launchdFixtures";
import { EMPTY_FILTER, type DiscoveryState } from "./launchdModel";
import { ServiceGroups } from "./ServiceGroups";
import { ServicesView } from "./ServicesView";

afterEach(cleanup);

const noop = () => undefined;

function readyState(services = sampleServices()): DiscoveryState {
  return {
    status: "ready",
    discovery: sampleDiscovery({ services }),
    refreshing: false,
  };
}

function renderList(overrides: Partial<Parameters<typeof ServicesView>[0]> = {}) {
  return render(
    <ServicesView
      state={readyState()}
      evidence={{ status: "ready", summaries: [] }}
      filter={EMPTY_FILTER}
      selectedId={undefined}
      refreshDisabled={false}
      onFilterChange={noop}
      onSelect={noop}
      onRefresh={noop}
      {...overrides}
    />,
  );
}

function groupTitles(): string[] {
  return Array.from(
    document.querySelectorAll(".services-group__title"),
    (node) => node.textContent ?? "",
  );
}

describe("start timing badge", () => {
  it("shows the start timing as visible text on the row, not only by colour", () => {
    renderList();
    expect(screen.getAllByText("登录时启动 · 条件保持运行").length).toBeGreaterThan(0);
  });

  it("shows unknown when a row has no plist details", () => {
    renderList({
      state: readyState([launchdService({ label: "com.example.bare", configFiles: [] })]),
    });
    expect(screen.getByText("未知")).toBeTruthy();
  });
});

describe("default system visibility", () => {
  it("hides system services by default and says how many were hidden", () => {
    renderList();
    expect(groupTitles()).toEqual(["用户自建的"]);
    expect(screen.getByText("已隐藏 2 个系统服务")).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "显示系统服务" }).getAttribute("aria-checked")).toBe(
      "false",
    );
  });

  it("reports the toggle through onFilterChange with showSystem set", () => {
    const onFilterChange = vi.fn();
    renderList({ onFilterChange });
    fireEvent.click(screen.getByRole("checkbox", { name: "显示系统服务" }));
    expect(onFilterChange).toHaveBeenCalledWith({ ...EMPTY_FILTER, showSystem: true });
  });

  it("adds a system group, without a hidden note, when the toggle is on", () => {
    renderList({ filter: { ...EMPTY_FILTER, showSystem: true } });
    expect(groupTitles()).toEqual(["用户自建的", "系统"]);
    expect(screen.queryByText(/已隐藏/)).toBeNull();
    expect(screen.getByRole("checkbox", { name: "显示系统服务" }).getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("explains a system service that the selection points at but the list hides", () => {
    renderList({ selectedId: "system/com.apple.metadata.mds" });
    expect(screen.getByText(/所选任务是系统服务，列表中已隐藏/)).toBeTruthy();
  });

  it("omits the system count when the inventory has no system services", () => {
    renderList({
      state: readyState([launchdService({ id: "gui/501/com.example.agent" })]),
    });
    expect(screen.queryByText(/已隐藏/)).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "显示系统服务" })).toBeNull();
  });
});

describe("groups", () => {
  it("shows a count and a plain name for each group", () => {
    renderList();
    const summary = document.querySelector(".services-group__summary");
    expect(summary?.textContent).toContain("用户自建的");
    expect(summary?.textContent).toContain("4 项");
  });

  it("hides a collapsed group's rows and shows them again when reopened", () => {
    renderList();
    expect(screen.getByText("example.agent")).toBeTruthy();
    const details = document.querySelector<HTMLDetailsElement>(".services-group")!;
    details.open = false;
    fireEvent(details, new Event("toggle"));
    expect(screen.queryByText("example.agent")).toBeNull();
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(screen.getByText("example.agent")).toBeTruthy();
  });

  it("omits a group with no services", () => {
    renderList({
      state: readyState([launchdService({ id: "gui/501/com.example.agent" })]),
    });
    expect(groupTitles()).toEqual(["用户自建的"]);
    expect(document.querySelectorAll(".services-group")).toHaveLength(1);
  });
});

describe("row content", () => {
  it("shows the purpose from the dictionary and the readable name", () => {
    renderList({
      state: readyState([
        launchdService({
          id: "gui/501/homebrew.mxcl.postgresql@16",
          label: "homebrew.mxcl.postgresql@16",
          configFiles: [
            configFile({
              path: "~/Library/LaunchAgents/homebrew.mxcl.postgresql@16.plist",
              details: {
                program: "/opt/homebrew/opt/postgresql@16/bin/postgres",
                programArguments: [],
                argumentsTruncated: false,
                environmentKeys: [],
              },
            }),
          ],
        }),
      ]),
    });
    expect(screen.getByText("postgresql@16")).toBeTruthy();
    expect(screen.getByText("关系型数据库")).toBeTruthy();
    expect(screen.queryByText("作用未知")).toBeNull();
  });

  it("marks an unknown purpose and shows the program file name instead", () => {
    renderList();
    expect(screen.getAllByText("作用未知").length).toBeGreaterThan(0);
    expect(screen.getAllByText("example").length).toBeGreaterThan(0);
  });

  it("does not show a purpose that was not read", () => {
    renderList({
      state: readyState([launchdService({ id: "gui/501/com.example.bare", label: "com.example.bare", configFiles: [] })]),
    });
    expect(screen.getByText("未记录程序路径")).toBeTruthy();
  });
});

describe("keyboard selection in groups", () => {
  it("moves from one group to the next with the arrow keys", () => {
    const onSelect = vi.fn();
    render(
      <ServiceGroups
        services={sampleServices()}
        visible={[
          launchdService({ id: "a", label: "com.example.one" }),
          launchdService({ id: "b", label: "homebrew.mxcl.redis", configFiles: [] }),
        ]}
        showSystem={false}
        onShowSystemChange={noop}
        selectedId="b"
        onSelect={onSelect}
      />,
    );
    // Homebrew sorts before the user group, so "b" is the first row and ArrowDown reaches "a".
    const first = screen.getByRole("button", { name: /homebrew\.mxcl\.redis/ });
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(onSelect).toHaveBeenCalledWith("a");
  });

  it("keeps a selected job's group open after the group was collapsed", () => {
    const { rerender } = render(
      <ServiceGroups
        services={[]}
        visible={[launchdService({ id: "a", label: "com.example.one" })]}
        showSystem={false}
        onShowSystemChange={noop}
        selectedId={undefined}
        onSelect={noop}
      />,
    );
    const details = document.querySelector<HTMLDetailsElement>(".services-group")!;
    details.open = false;
    fireEvent(details, new Event("toggle"));
    rerender(
      <ServiceGroups
        services={[]}
        visible={[launchdService({ id: "a", label: "com.example.one" })]}
        showSystem={false}
        onShowSystemChange={noop}
        selectedId="a"
        onSelect={noop}
      />,
    );
    expect(screen.getByText("example.one")).toBeTruthy();
  });
});
