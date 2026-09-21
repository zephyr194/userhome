import type { Appearance } from "../ipc/settings";

const APPEARANCE_ATTRIBUTES: Record<Appearance, string> = {
  SYSTEM: "system",
  LIGHT: "light",
  DARK: "dark",
};

export function applyAppearance(appearance: Appearance): void {
  document.documentElement.dataset.appearance =
    APPEARANCE_ATTRIBUTES[appearance];
}
