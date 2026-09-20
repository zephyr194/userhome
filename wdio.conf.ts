import type { TauriCapabilities } from "@wdio/tauri-service";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const appBinaryPath = "./src-tauri/target/debug/userhome";
const inheritedE2eHome = process.env.USERHOME_E2E_HOME;
const e2eHomePrefix = join(tmpdir(), "userhome-e2e-home-");
const e2eHome =
  inheritedE2eHome?.startsWith(e2eHomePrefix)
    ? inheritedE2eHome
    : mkdtempSync(e2eHomePrefix);
const ownsE2eHome = e2eHome !== inheritedE2eHome;

process.env.USERHOME_E2E_HOME = e2eHome;
if (ownsE2eHome) {
  process.once("exit", () => {
    rmSync(e2eHome, { recursive: true, force: true });
  });
}

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
