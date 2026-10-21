import { createContext } from "react";
import type { NavigationIntent } from "./routeDefinitions";

export const RouteNavigationContext = createContext<
  ((intent: NavigationIntent) => void) | undefined
>(undefined);
