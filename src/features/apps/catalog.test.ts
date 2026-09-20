import { mockIPC } from "@tauri-apps/api/mocks";
import { describe, expect, it } from "vitest";
import { listManagedApps } from "../../ipc/catalog";

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
        applications,
      };
    });

    const catalog = await listManagedApps();

    expect(catalog.schemaVersion).toBe(1);
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
      applications: [applications[0], applications[0]],
    }));
    await expect(listManagedApps()).rejects.toMatchObject({ code: "INTERNAL" });

    mockIPC(() => ({
      schemaVersion: 1,
      applications: Array.from({ length: 33 }, (_, index) => ({
        ...applications[0],
        id: `app-${index}`,
      })),
    }));
    await expect(listManagedApps()).rejects.toMatchObject({ code: "INTERNAL" });
  });
});
