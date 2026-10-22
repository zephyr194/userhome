// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VerticalMenu, type VerticalMenuItem } from "./VerticalMenu";

const ITEMS: readonly VerticalMenuItem[] = [
  { id: "dotenv", label: "项目 dotenv", description: "授权目录中的 .env 文件" },
  { id: "zsh", label: "用户 zsh", description: "启动文件与读取顺序" },
  { id: "launchctl", label: "登录会话", description: "GUI 应用看到的变量" },
];

afterEach(() => {
  cleanup();
});

describe("VerticalMenu", () => {
  it("renders a vertical tablist named by its label with one selected item", () => {
    render(
      <VerticalMenu
        items={ITEMS}
        label="环境变量域"
        onSelect={() => {}}
        selected="zsh"
      />,
    );

    const list = screen.getByRole("tablist", { name: "环境变量域" });
    expect(list.getAttribute("aria-orientation")).toBe("vertical");

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    const selected = tabs.filter((tab) => tab.getAttribute("aria-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toContain("用户 zsh");
    expect(selected[0].getAttribute("aria-current")).toBe("true");
  });

  it("shows the label in bold and the description beside it", () => {
    render(
      <VerticalMenu
        items={ITEMS}
        label="环境变量域"
        onSelect={() => {}}
        selected="dotenv"
      />,
    );

    const tab = screen.getByRole("tab", { name: /项目 dotenv/ });
    const [title, description] = Array.from(tab.querySelectorAll("span"));
    expect(title.textContent).toBe("项目 dotenv");
    expect(title.className).toContain("font-semibold");
    expect(description.textContent).toBe("授权目录中的 .env 文件");
    expect(description.className).toContain("text-muted-foreground");
    expect(description.className).not.toContain("truncate");
  });

  it("selects an item on click", () => {
    const onSelect = vi.fn();
    render(
      <VerticalMenu
        items={ITEMS}
        label="环境变量域"
        onSelect={onSelect}
        selected="dotenv"
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /登录会话/ }));

    expect(onSelect).toHaveBeenCalledWith("launchctl");
  });

  it("moves the selection with the arrow keys and wraps at the ends", () => {
    const onSelect = vi.fn();
    render(
      <VerticalMenu
        items={ITEMS}
        label="环境变量域"
        onSelect={onSelect}
        selected="zsh"
      />,
    );

    const zsh = screen.getByRole("tab", { name: /用户 zsh/ });
    zsh.focus();
    fireEvent.keyDown(zsh, { key: "ArrowDown" });
    expect(onSelect).toHaveBeenLastCalledWith("launchctl");

    const dotenv = screen.getByRole("tab", { name: /项目 dotenv/ });
    dotenv.focus();
    fireEvent.keyDown(dotenv, { key: "ArrowUp" });
    expect(onSelect).toHaveBeenLastCalledWith("launchctl");
  });

  it("falls back to the first item when the selected id is unknown", () => {
    render(
      <VerticalMenu
        items={ITEMS}
        label="环境变量域"
        onSelect={() => {}}
        selected="missing"
      />,
    );

    const tab = screen.getByRole("tab", { name: /项目 dotenv/ });
    expect(tab.getAttribute("aria-selected")).toBe("true");
  });
});
