// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { CaddyRules } from "../../ipc/caddy";
import {
  ACCESS_LOG_PRIVACY_NOTICE,
  createIdSource,
  mapIssuesToFields,
  siteDraftsFromRules,
  type SiteDraft,
} from "./caddyRulesModel";
import { CaddyRulesEditor } from "./CaddyRulesEditor";

afterEach(cleanup);

const RULES: CaddyRules = {
  version: 1,
  sites: [
    {
      enabled: true,
      listen: { host: "127.0.0.1", port: 8080 },
      upstreams: [{ scheme: "http", host: "127.0.0.1", port: 3000 }],
    },
  ],
};

const NOOP = () => undefined;

function isDisabled(element: HTMLElement): boolean {
  return (element as HTMLButtonElement).disabled;
}

function isChecked(element: HTMLElement): boolean {
  return element.getAttribute("aria-checked") === "true";
}

function drafts(rules: CaddyRules = RULES): SiteDraft[] {
  return siteDraftsFromRules(rules, createIdSource());
}

function markup(sites: SiteDraft[], mapped = mapIssuesToFields([])): string {
  return renderToStaticMarkup(
    <CaddyRulesEditor
      sites={sites}
      localErrors={{}}
      mapped={mapped}
      exposedSites={new Set()}
      ids={createIdSource()}
      onChange={NOOP}
    />,
  );
}

function Harness({ initial }: { initial: SiteDraft[] }) {
  const [sites, setSites] = useState(initial);
  const [ids] = useState(() => createIdSource());
  return (
    <CaddyRulesEditor
      sites={sites}
      localErrors={{}}
      mapped={mapIssuesToFields([])}
      exposedSites={new Set()}
      ids={ids}
      onChange={setSites}
    />
  );
}

describe("directive row markup", () => {
  it("gives every row a directive dropdown and each row's value its own label", () => {
    const html = markup(drafts());

    expect(html.match(/aria-haspopup="listbox"/g)?.length).toBeGreaterThanOrEqual(3);
    for (const label of ["指令", "监听主机", "监听端口", "上游协议", "上游主机", "上游端口"]) {
      expect(html, label).toContain(label);
    }
  });

  it("explains why the required listen rows cannot be removed", () => {
    const html = markup(drafts());

    expect(html).toContain("删除监听主机（站点 1）");
    expect(html.match(/必填指令，不能删除。/g)).toHaveLength(2);
    expect(html).toContain("至少保留一个上游。");
  });

  it("shows a field error under the value control it belongs to", () => {
    const mapped = mapIssuesToFields([
      {
        code: "INVALID_PORT",
        severity: "ERROR",
        site: 0,
        upstream: 0,
        field: "upstreams.port",
        message: "上游端口不合法。",
      },
    ]);
    const html = markup(drafts(), mapped);

    expect(html).toContain("上游端口不合法。");
    expect(html).toContain('aria-invalid="true"');
  });

  it("lists the unused directives in the add group, with the access log notice while it is off", () => {
    const html = markup(drafts());

    expect(html).toContain('aria-label="添加指令"');
    expect(html).toContain("使用 HTTPS（已有证书与私钥）");
    expect(html).toContain("上游（反向代理目标）");
    expect(html).toContain(ACCESS_LOG_PRIVACY_NOTICE);
  });

  it("drops HTTPS from the add group once it is in use and shows its row instead", () => {
    const html = markup(
      drafts({
        version: 1,
        sites: [
          {
            ...RULES.sites[0]!,
            tls: { certificateGrantId: "3f2b8c1e-6a4d-4b7e-9c2f-1a2b3c4d5e6f", privateKeyGrantId: "7c9d0e1f-2a3b-4c5d-8e6f-7a8b9c0d1e2f" },
          },
        ],
      }),
    );

    expect(html).toContain("删除HTTPS（站点 1）");
    expect(html.match(/使用 HTTPS（已有证书与私钥）/g)).toHaveLength(1);
  });
});

describe("directive row interaction", () => {
  it("adds an upstream row and removes it again from the second row's delete control", () => {
    render(<Harness initial={drafts()} />);
    const group = screen.getByRole("group", { name: "添加指令" });

    fireEvent.click(within(group).getByRole("button", { name: "上游（反向代理目标）" }));
    expect(screen.getAllByLabelText(/^删除上游 /)).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "删除上游 2（站点 1）" }));
    const remaining = screen.getAllByLabelText(/^删除上游 /);
    expect(remaining).toHaveLength(1);
    expect(isDisabled(remaining[0]!)).toBe(true);
  });

  it("turns on access log from the add group and turns it off from its row switch", () => {
    render(<Harness initial={drafts()} />);
    const group = screen.getByRole("group", { name: "添加指令" });

    fireEvent.click(within(group).getByRole("button", { name: "记录访问日志" }));
    const toggle = screen.getByRole("switch", { name: "记录访问日志" });
    expect(isChecked(toggle)).toBe(true);

    fireEvent.click(toggle);
    expect(screen.queryByRole("switch", { name: "记录访问日志" })).toBeNull();
    const addButton = within(screen.getByRole("group", { name: "添加指令" })).getByRole("button", { name: "记录访问日志" });
    expect(isDisabled(addButton)).toBe(false);
  });

  it("keeps the only upstream and both listen rows from being deleted", () => {
    render(<Harness initial={drafts()} />);

    expect(isDisabled(screen.getByRole("button", { name: "删除上游 1（站点 1）" }))).toBe(true);
    expect(isDisabled(screen.getByRole("button", { name: "删除监听主机（站点 1）" }))).toBe(true);
    expect(isDisabled(screen.getByRole("button", { name: "删除监听端口（站点 1）" }))).toBe(true);
  });
});
