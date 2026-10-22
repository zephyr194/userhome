import { createContext, useContext, useState } from "react";

export interface SectionContextValue {
  /** Id of the section the active tool shows. */
  section: string;
  select: (section: string) => void;
}

export const SectionContext = createContext<SectionContextValue | undefined>(undefined);

/**
 * The section a tool page shows. Inside the app the shell owns it, so the
 * sidebar and the page agree; a page rendered on its own keeps it in state.
 */
export function useToolSection(fallback: string): [string, (section: string) => void] {
  const shared = useContext(SectionContext);
  const [local, setLocal] = useState(fallback);
  return shared ? [shared.section, shared.select] : [local, setLocal];
}
