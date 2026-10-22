import { mockIPC } from "@tauri-apps/api/mocks";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { listServices } from "../../ipc/services";
import { ServicesPage } from "./ServicesPage";

describe("services", () => {
  it("renders the service inventory loading state", () => {
    const markup = renderToStaticMarkup(<ServicesPage />);
    expect(markup).toContain("服务清单");
    expect(markup).toContain("正在读取本机状态");
  });

  it("decodes Caddy and Unbound from mocked inventory", async () => {
    mockIPC((command) => {
      if (command === "list_services") {
        return [
          {
            serviceId: "caddy",
            displayName: "Caddy",
            state: "STARTED",
            status: "started",
            scope: "USER",
            user: "alice",
            manageable: true,
          },
          {
            serviceId: "unbound",
            displayName: "Unbound",
            state: "STOPPED",
            status: "stopped",
            scope: "SYSTEM",
            user: "root",
            manageable: false,
          },
        ];
      }
      return {
        serviceId: "caddy",
        displayName: "Caddy",
        state: "STARTED",
        status: "started",
        scope: "USER",
        user: "alice",
        manageable: true,
        packageVersion: "2.11.4",
        configValidity: "INVALID",
        configIssue: "Caddyfile validation failed.",
      };
    });

    await expect(listServices()).resolves.toHaveLength(2);
  });
});
