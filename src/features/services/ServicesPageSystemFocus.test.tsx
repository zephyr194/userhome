// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sampleDiscovery } from "./launchdFixtures";
import { ServicesPage } from "./ServicesPage";

const listLaunchdServices = vi.fn();
const listServices = vi.fn();

vi.mock("../../ipc/services", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/services")>()),
  listLaunchdServices: () => listLaunchdServices(),
  listServices: () => listServices(),
}));

async function settle() {
  await act(async () => {});
}

beforeEach(() => {
  listServices.mockResolvedValue([]);
  listLaunchdServices.mockResolvedValue(sampleDiscovery());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("services page focus", () => {
  it("opens the system toggle when the focused job is a hidden system service", async () => {
    render(
      <ServicesPage
        initialFocus={{ label: "com.vendor.daemon", domain: "SYSTEM" }}
      />,
    );
    await settle();
    expect(screen.getByRole("checkbox", { name: "显示系统服务" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(screen.getAllByText("vendor.daemon").length).toBeGreaterThan(0);
  });

  it("leaves the toggle off when the focused job is an ordinary job", async () => {
    render(
      <ServicesPage
        initialFocus={{ label: "com.example.agent", domain: "GUI" }}
      />,
    );
    await settle();
    expect(screen.getByRole("checkbox", { name: "显示系统服务" }).getAttribute("aria-checked")).toBe(
      "false",
    );
  });
});
