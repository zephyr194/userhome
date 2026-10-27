import { describe, expect, it } from "vitest";
import { en } from "../../i18n/messages/en";
import { zhCN } from "../../i18n/messages/zh-CN";

describe("环境变量页空状态与读取顺序文案", () => {
  it("zsh empty state names the set-variable button shown on the page", () => {
    expect(zhCN["env.zsh.variables.empty"]).toContain(`“${zhCN["env.zsh.addVariable"]}”`);
    expect(en["env.zsh.variables.empty"]).toContain(`“${en["env.zsh.addVariable"]}”`);
  });

  it("login session empty note names the set-variable button and keeps the terminal caveat", () => {
    expect(zhCN["env.launchctl.emptyNote"]).toContain(`“${zhCN["env.launchctl.setVariable"]}”`);
    expect(zhCN["env.launchctl.emptyNote"]).toContain("终端里设置的变量不会出现");
    expect(en["env.launchctl.emptyNote"]).toContain(`“${en["env.launchctl.setVariable"]}”`);
    expect(en["env.launchctl.emptyNote"]).toContain("Variables set in a terminal do not");
  });

  it("dotenv empty state names the set-variable button shown on the page", () => {
    expect(zhCN["env.dotenv.noVariables"]).toContain(`“${zhCN["env.dotenv.addVariable"]}”`);
    expect(en["env.dotenv.noVariables"]).toContain(`“${en["env.dotenv.addVariable"]}”`);
  });

  it("zsh reading order is named the same in the collapsed section and its heading", () => {
    expect(zhCN["env.zsh.details"]).toBe(zhCN["env.zsh.order.heading"]);
    expect(en["env.zsh.details"]).toBe(en["env.zsh.order.heading"]);
  });
});
