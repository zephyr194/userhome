import type { TauriCapabilities } from "@wdio/tauri-service";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const appBinaryPath = "./src-tauri/target/debug/userhome";
const e2eHomePrefix = join(tmpdir(), "userhome-e2e-home-");
const e2eHome = mkdtempSync(e2eHomePrefix);

process.once("exit", () => {
  rmSync(e2eHome, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
});

const settingsDirectory = join(
  e2eHome,
  "Library",
  "Application Support",
  "com.zephyr194.userhome",
);
mkdirSync(settingsDirectory, { recursive: true, mode: 0o700 });
chmodSync(settingsDirectory, 0o700);
const settingsPath = join(settingsDirectory, "preferences.json");
writeFileSync(
  settingsPath,
  JSON.stringify({
    schemaVersion: 1,
    appearance: "SYSTEM",
    openWindowOnLaunch: false,
    closeBehavior: "KEEP_RUNNING_IN_TRAY",
    restoreSelection: false,
    refreshOnLaunch: true,
    refreshOnReopen: true,
    providerTimeoutPreset: "STANDARD",
    preferredEditorMode: "STRUCTURED",
    backupRetention: 20,
    optionalDiscoveryRoots: [],
    // 固定界面语言：缺省 "system" 会跟随 WebView 的 navigator.language，
    // CI runner 是英文系统，导航与页面文案会变成英文，而 spec 断言的是中文。
    language: "zh-CN",
  }),
  { mode: 0o600 },
);
chmodSync(settingsPath, 0o600);

const capabilities: TauriCapabilities[] = [
  {
    browserName: "tauri",
    "tauri:options": {
      application: appBinaryPath,
    },
  },
];

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./e2e/**/*.spec.ts"],
  maxInstances: 1,
  capabilities,
  services: [
    [
      "@wdio/tauri-service",
      {
        appBinaryPath,
        driverProvider: "embedded",
        env: {
          HOME: e2eHome,
          XDG_CONFIG_HOME: join(e2eHome, ".config"),
        },
      },
    ],
  ],
  framework: "mocha",
  reporters: ["spec"],
  logLevel: "info",
  waitforTimeout: 10_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 1,
  mochaOpts: {
    ui: "bdd",
    timeout: 60_000,
  },
};
