import { mockIPC } from "@tauri-apps/api/mocks";
import { describe, expect, it } from "vitest";
import { listManagedApps } from "../../ipc/catalog";

const coveragePolicy = {
  priorityATotal: 0,
  priorityAUsable: 0,
  priorityBTotal: 6,
  priorityBCovered: 6,
  minimumEligibleTextPercent: 90,
};

const applications = [
  "github-copilot",
  "caddy",
  "git",
  "openssh",
  "zsh",
  "npm",
].map((id) => ({
  id,
  displayName: id,
  description: `${id} description`,
  iconKey: id,
  priority: "PRIORITY_B",
  detectionEvidence: [{ kind: "HOME_PATH", value: `HOME/${id}` }],
  support: {
    limitations: ["Catalog only."],
    exclusions: ["Secrets excluded."],
    requirement: "Review new paths.",
  },
  capabilities: ["DETECT", "READ_CONFIG"],
  managedDocumentCount: 1,
  serviceCount: id === "caddy" ? 1 : 0,
  configDocuments: [{ pathTemplate: "~/.should-not-cross-ipc" }],
}));

describe("listManagedApps", () => {
  it("decodes the versioned catalog summary without retaining path authority", async () => {
    mockIPC((command, payload) => {
      expect(command).toBe("list_managed_apps");
      expect(payload).toEqual({});
      return {
        schemaVersion: 1,
        coveragePolicy,
        applications,
      };
    });

    const catalog = await listManagedApps();

    expect(catalog.schemaVersion).toBe(1);
    expect(catalog.coveragePolicy).toEqual(coveragePolicy);
    expect(catalog.applications).toHaveLength(6);
    expect(catalog.applications.map((app) => app.id)).toEqual([
      "github-copilot",
      "caddy",
      "git",
      "openssh",
      "zsh",
      "npm",
    ]);
    expect(catalog.applications[0].coverageClass).toBe("MANAGED_READ_ONLY");
    expect(catalog.applications[0].presentation).toEqual({
      category: "Other",
      configDocuments: [],
    });
    expect(catalog.applications[0]).not.toHaveProperty("configDocuments");
  });

  it("rejects duplicate IDs and oversized application lists", async () => {
    mockIPC(() => ({
      schemaVersion: 1,
      coveragePolicy,
      applications: [applications[0], applications[0]],
    }));
    await expect(listManagedApps()).rejects.toMatchObject({ code: "INTERNAL" });

    mockIPC(() => ({
      schemaVersion: 1,
      coveragePolicy,
      applications: Array.from({ length: 33 }, (_, index) => ({
        ...applications[0],
        id: `app-${index}`,
      })),
    }));
    await expect(listManagedApps()).rejects.toMatchObject({ code: "INTERNAL" });
  });
});
