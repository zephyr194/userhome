import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { applyAppearance } from "./app/appearance";
import { resolveLocale, translate } from "./i18n";
import {
  DEFAULT_USER_PREFERENCES,
  getPreferences,
  type LoadedPreferences,
} from "./ipc/settings";
import "./styles/global.css";

applyAppearance(DEFAULT_USER_PREFERENCES.appearance);

async function loadInitialPreferences(): Promise<LoadedPreferences> {
  try {
    return await getPreferences();
  } catch {
    return {
      preferences: DEFAULT_USER_PREFERENCES,
      diagnostic: {
        code: "READ_FAILED",
        message: translate(
          resolveLocale(DEFAULT_USER_PREFERENCES.language, globalThis.navigator?.language),
          "app.preferences.readFailed",
        ),
      },
    };
  }
}

async function start() {
  let E2eFormProbe: React.ComponentType | undefined;
  if (import.meta.env.VITE_E2E === "true") {
    await import("@wdio/tauri-plugin");
    E2eFormProbe = (await import("./e2e/E2eFormProbe")).E2eFormProbe;
  }

  const initialPreferences = await loadInitialPreferences();
  applyAppearance(initialPreferences.preferences.appearance);

  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App initialPreferences={initialPreferences} />
      {E2eFormProbe ? <E2eFormProbe /> : null}
    </React.StrictMode>,
  );
}

void start();
