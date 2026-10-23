import type { ReactNode } from "react";
import type { AppToolIconKey } from "./appConfigCatalog";

const STROKES: Record<AppToolIconKey, ReactNode> = {
  branch: (
    <>
      <path d="M5 2h4v4H5z" />
      <path d="M15 2h4v4h-4z" />
      <path d="M5 18h4v4H5z" />
      <path d="M7 6v12" />
      <path d="M17 6v2l-8 4" />
    </>
  ),
  package: (
    <>
      <path d="M3 7l9-4 9 4v10l-9 4-9-4z" />
      <path d="M3 7l9 4 9-4" />
      <path d="M12 11v10" />
    </>
  ),
  container: (
    <>
      <path d="M3 12h4v4H3z" />
      <path d="M8 12h4v4H8z" />
      <path d="M13 12h4v4h-4z" />
      <path d="M8 7h4v4H8z" />
      <path d="M3 17h18" />
    </>
  ),
  editor: (
    <>
      <path d="M3 4h18v16H3z" />
      <path d="M9 8v8" />
      <path d="M6 9h2" />
      <path d="M6 15h2" />
    </>
  ),
  terminal: (
    <>
      <path d="M3 4h18v16H3z" />
      <path d="M7 9l3 3-3 3" />
      <path d="M12 15h5" />
    </>
  ),
  key: (
    <>
      <path d="M3 8h6v6H3z" />
      <path d="M9 11h12" />
      <path d="M17 11v4" />
      <path d="M20 11v3" />
    </>
  ),
};

/** A 24px straight-line glyph in currentColor. Decorative: the tool name carries the meaning. */
export function AppToolIcon({ icon }: { icon: AppToolIconKey }) {
  return (
    <svg
      aria-hidden="true"
      className="shrink-0"
      fill="none"
      focusable="false"
      height={24}
      stroke="currentColor"
      strokeLinecap="square"
      strokeLinejoin="miter"
      strokeWidth={1.5}
      viewBox="0 0 24 24"
      width={24}
    >
      {STROKES[icon]}
    </svg>
  );
}
