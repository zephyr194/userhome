import type { Appearance } from "../ipc/settings";

const APPEARANCE_ATTRIBUTES: Record<Appearance, string> = {
  SYSTEM: "system",
  LIGHT: "light",
  DARK: "dark",
};

const APPEARANCE_COLOR_SCHEMES: Record<Appearance, string> = {
  SYSTEM: "light dark",
  LIGHT: "light",
  DARK: "dark",
};

/**
 * Applies the persisted appearance protocol. System follows the OS media query
 * through `color-scheme: light dark`; Light and Dark pin the scheme.
 */
export function applyAppearance(appearance: Appearance): void {
  document.documentElement.dataset.appearance =
    APPEARANCE_ATTRIBUTES[appearance];
  document.documentElement.style.colorScheme =
    APPEARANCE_COLOR_SCHEMES[appearance];
}
