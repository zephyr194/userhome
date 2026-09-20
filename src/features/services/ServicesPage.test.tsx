import { mockIPC } from "@tauri-apps/api/mocks";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getService, listServices } from "../../ipc/services";
import { ServiceDetails } from "./ServiceDetails";
import { ServicesPage } from "./ServicesPage";

describe("services", () => {
  it("renders the service inventory loading state", () => {
    const markup = renderToStaticMarkup(<ServicesPage />);
    expect(markup).toContain("服务清单");
    expect(markup).toContain("正在刷新服务状态");
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
    await expect(getService("caddy")).resolves.toMatchObject({
      packageVersion: "2.11.4",
      configValidity: "INVALID",
    });
  });

  it("keeps unknown services read-only and shows config validity separately", () => {
    const unknown = renderToStaticMarkup(
      <ServiceDetails
        details={{
          serviceId: "other",
          displayName: "other",
          state: "UNKNOWN",
          status: "unknown",
          scope: "UNKNOWN",
          manageable: false,
          configValidity: "UNAVAILABLE",
        }}
        onAction={() => {}}
      />,
    );
    const caddy = renderToStaticMarkup(
      <ServiceDetails
        details={{
          serviceId: "caddy",
          displayName: "Caddy",
          state: "STARTED",
          status: "started",
          scope: "USER",
          manageable: true,
          configValidity: "INVALID",
        }}
        onAction={() => {}}
      />,
    );

    expect(unknown).toContain("仅供查看");
    expect(unknown).not.toContain(">启动<");
    expect(caddy).toContain("Caddyfile");
    expect(caddy).toContain("无效");
    expect(caddy).toContain("disabled");
  });
});
