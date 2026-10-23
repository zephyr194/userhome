import { describe, expect, it } from "vitest";
import { translate } from "../../i18n";
import { zhCN } from "../../i18n/messages/zh-CN";
import { en } from "../../i18n/messages/en";
import { CREATED_LABEL, CREATED_OWNERSHIP, configFile, launchdService, APPLE_OWNERSHIP, DAEMON_OWNERSHIP } from "./launchdFixtures";
import { SERVICE_DICTIONARY } from "./serviceDictionary";
import {
  displayNameOf,
  groupServices,
  injectorOf,
  programFileName,
  purposeOf,
} from "./serviceProfile";

const zh = (key: Parameters<typeof translate>[1], params?: Parameters<typeof translate>[2]) =>
  translate("zh-CN", key, params);

const userFile = (program: string | undefined, overrides = {}) =>
  configFile({
    details: {
      ...(program === undefined ? {} : { program }),
      programArguments: program === undefined ? [] : [program],
      argumentsTruncated: false,
      environmentKeys: [],
    },
    ...overrides,
  });

describe("injectorOf", () => {
  it("puts UserHome-created and adopted jobs in the UserHome group", () => {
    expect(
      injectorOf(launchdService({ label: CREATED_LABEL, ownership: CREATED_OWNERSHIP })),
    ).toBe("USERHOME");
    expect(
      injectorOf(
        launchdService({
          label: "com.zephyr194.userhome.agent.caddy",
          ownership: { ...CREATED_OWNERSHIP, kind: "USERHOME_ADOPTED" },
        }),
      ),
    ).toBe("USERHOME");
  });

  it("puts Homebrew formula jobs in the Homebrew group", () => {
    expect(
      injectorOf(
        launchdService({
          label: "homebrew.mxcl.postgresql@16",
          configFiles: [userFile("/opt/homebrew/opt/postgresql@16/bin/postgres")],
        }),
      ),
    ).toBe("HOMEBREW");
  });

  it("puts jobs whose program lives in an app bundle in the app group", () => {
    expect(
      injectorOf(
        launchdService({
          label: "com.example.caddyd",
          configFiles: [userFile("/Applications/Caddy.app/Contents/MacOS/caddyd")],
        }),
      ),
    ).toBe("APP");
    expect(
      injectorOf(
        launchdService({
          label: "com.example.helper",
          configFiles: [userFile("~/Applications/Helper.app/Contents/MacOS/helper")],
        }),
      ),
    ).toBe("APP");
  });

  it("puts a global agent whose program sits in an app bundle in the app group", () => {
    expect(
      injectorOf(
        launchdService({
          label: "com.example.updater",
          scope: "GLOBAL_AGENT",
          ownership: { ...CREATED_OWNERSHIP, kind: "GLOBAL_AGENT", modifiable: false, readOnlyReasons: ["GLOBAL_AGENT_LOCATION"] },
          configFiles: [
            configFile({
              path: "/Library/LaunchAgents/com.example.updater.plist",
              directory: "GLOBAL_LAUNCH_AGENTS",
              scope: "GLOBAL_AGENT",
              details: {
                program: "/Library/Application Support/Updater/Updater.app/Contents/MacOS/updater",
                programArguments: [],
                argumentsTruncated: false,
                environmentKeys: [],
              },
            }),
          ],
        }),
      ),
    ).toBe("APP");
  });

  it("puts the current user's own agents in the user group", () => {
    expect(injectorOf(launchdService())).toBe("USER");
    expect(
      injectorOf(
        launchdService({
          label: "com.example.worker",
          configFiles: [userFile("/usr/local/bin/worker")],
        }),
      ),
    ).toBe("USER");
  });

  it("puts a job it cannot place in the third-party group", () => {
    expect(injectorOf(launchdService({ configFiles: [] }))).toBe("THIRD_PARTY");
    expect(
      injectorOf(
        launchdService({
          label: "com.vendor.agent",
          configFiles: [
            configFile({
              path: "/Library/LaunchAgents/com.vendor.agent.plist",
              directory: "GLOBAL_LAUNCH_AGENTS",
              scope: "GLOBAL_AGENT",
              details: {
                program: "/Library/Vendor/agent",
                programArguments: [],
                argumentsTruncated: false,
                environmentKeys: [],
              },
            }),
          ],
        }),
      ),
    ).toBe("THIRD_PARTY");
  });

  it("puts system jobs and com.apple. labels in the system group", () => {
    expect(
      injectorOf(
        launchdService({ domain: "SYSTEM", scope: "SYSTEM_DAEMON", ownership: DAEMON_OWNERSHIP }),
      ),
    ).toBe("SYSTEM");
    expect(
      injectorOf(
        launchdService({
          label: "com.apple.metadata.mds",
          domain: "SYSTEM",
          ownership: APPLE_OWNERSHIP,
        }),
      ),
    ).toBe("SYSTEM");
  });

  it("does not let a com.apple. label in a user folder count as a user job", () => {
    expect(
      injectorOf(launchdService({ label: "com.apple.something", ownership: APPLE_OWNERSHIP })),
    ).toBe("SYSTEM");
  });
});

describe("displayNameOf", () => {
  it("uses the formula name for Homebrew jobs", () => {
    expect(displayNameOf(launchdService({ label: "homebrew.mxcl.postgresql@16" }))).toBe(
      "postgresql@16",
    );
  });

  it("uses the task name for UserHome jobs", () => {
    expect(displayNameOf(launchdService({ label: CREATED_LABEL, ownership: CREATED_OWNERSHIP }))).toBe(
      "agent.demo",
    );
  });

  it("uses the app name for app-installed jobs", () => {
    expect(
      displayNameOf(
        launchdService({
          label: "com.example.caddyd",
          configFiles: [userFile("/Applications/Caddy.app/Contents/MacOS/caddyd")],
        }),
      ),
    ).toBe("Caddy");
  });

  it("drops common reverse-domain prefixes and keeps the last two segments", () => {
    expect(displayNameOf(launchdService({ label: "com.example.agent" }))).toBe("example.agent");
    expect(displayNameOf(launchdService({ label: "com.vendor.daemon" }))).toBe("vendor.daemon");
  });

  it("keeps a short label whole", () => {
    expect(displayNameOf(launchdService({ label: "broken", configFiles: [] }))).toBe("broken");
  });
});

describe("programFileName", () => {
  it("returns the program's file name without its directory", () => {
    expect(programFileName(launchdService({ configFiles: [userFile("/usr/local/bin/example")] }))).toBe(
      "example",
    );
  });

  it("is undefined when no program path was read", () => {
    expect(programFileName(launchdService({ configFiles: [] }))).toBeUndefined();
  });
});

describe("purposeOf", () => {
  it("describes a dictionary match from the label", () => {
    expect(
      purposeOf(
        launchdService({
          label: "homebrew.mxcl.postgresql@16",
          configFiles: [userFile("/opt/homebrew/opt/postgresql@16/bin/postgres")],
        }),
        zh,
      ),
    ).toBe("关系型数据库");
  });

  it("describes a dictionary match from the program file name", () => {
    expect(
      purposeOf(
        launchdService({
          label: "com.example.agent",
          configFiles: [userFile("/opt/homebrew/bin/redis-server")],
        }),
        zh,
      ),
    ).toBe("内存键值存储");
  });

  it("does not match a key inside a longer word", () => {
    expect(
      purposeOf(
        launchdService({ label: "com.example.redisish", configFiles: [userFile("/usr/local/bin/x")] }),
        zh,
      ),
    ).toBeNull();
  });

  it("falls back to the formula name for Homebrew jobs outside the dictionary", () => {
    expect(
      purposeOf(
        launchdService({ label: "homebrew.mxcl.somekit", configFiles: [userFile("/opt/homebrew/bin/somekit")] }),
        zh,
      ),
    ).toBe("Homebrew 安装的 somekit");
  });

  it("falls back to the app name for app-installed jobs outside the dictionary", () => {
    expect(
      purposeOf(
        launchdService({
          label: "com.example.worker",
          configFiles: [userFile("/Applications/Acme.app/Contents/MacOS/worker")],
        }),
        zh,
      ),
    ).toBe("Acme 的后台组件");
  });

  it("returns null rather than inventing a purpose", () => {
    expect(
      purposeOf(launchdService({ label: "com.example.agent", configFiles: [userFile("/usr/local/bin/example")] }), zh),
    ).toBeNull();
    expect(purposeOf(launchdService({ label: "com.example.agent", configFiles: [] }), zh)).toBeNull();
  });

  it("translates the fallback text into English", () => {
    const text = purposeOf(
      launchdService({ label: "homebrew.mxcl.somekit", configFiles: [] }),
      (key, params) => translate("en", key, params),
    );
    expect(text).toBe("Installed by Homebrew: somekit");
  });
});

describe("groupServices", () => {
  it("lists groups in the fixed order and skips empty ones", () => {
    const groups = groupServices([
      launchdService({ id: "system/com.apple.x", label: "com.apple.x", domain: "SYSTEM", ownership: APPLE_OWNERSHIP }),
      launchdService({ id: "a", label: "com.example.agent" }),
      launchdService({ id: "b", label: "homebrew.mxcl.redis", configFiles: [] }),
      launchdService({ id: "c", label: CREATED_LABEL, ownership: CREATED_OWNERSHIP }),
    ]);
    expect(groups.map((group) => group.injector)).toEqual([
      "USERHOME",
      "HOMEBREW",
      "USER",
      "SYSTEM",
    ]);
    expect(groups.map((group) => group.services.length)).toEqual([1, 1, 1, 1]);
  });

  it("keeps the services of a group in their input order", () => {
    const [group] = groupServices([
      launchdService({ id: "1", label: "com.example.one" }),
      launchdService({ id: "2", label: "com.example.two" }),
    ]);
    expect(group.services.map((service) => service.id)).toEqual(["1", "2"]);
  });

  it("returns no groups for no services", () => {
    expect(groupServices([])).toEqual([]);
  });
});

describe("service dictionary", () => {
  it("has unique, lowercase keys", () => {
    const keys = SERVICE_DICTIONARY.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const key of keys) {
      expect(key, key).toBe(key.toLowerCase());
      expect(key.trim(), key).not.toBe("");
    }
  });

  it("points only at purposes that have a non-empty zh-CN and en text", () => {
    for (const entry of SERVICE_DICTIONARY) {
      expect(zhCN[entry.purpose].trim(), entry.key).not.toBe("");
      expect(en[entry.purpose].trim(), entry.key).not.toBe("");
    }
  });

  it("names the common development services", () => {
    const keys = new Set(SERVICE_DICTIONARY.map((entry) => entry.key));
    for (const key of ["postgres", "mysql", "redis", "nginx", "caddy", "docker", "ollama", "php-fpm"]) {
      expect(keys.has(key), key).toBe(true);
    }
  });
});
