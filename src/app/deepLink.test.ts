import { describe, expect, it } from "vitest";
import {
  DEEP_LINK_MAX_LENGTH,
  DEEP_LINK_ROUTE_IDS,
  buildPageDeepLink,
  listDeepLinks,
  parseDeepLink,
  validateDeepLinkPayload,
} from "./deepLink";
import { APP_ROUTES, routeSectionsOf } from "./routeDefinitions";
import { SETTINGS_GROUPS } from "../features/settings/settingsGroups";

describe("parseDeepLink", () => {
  it("resolves every whitelisted route to a navigation intent from the deep-link source", () => {
    expect(parseDeepLink("userhome://open/dashboard")).toEqual({
      routeId: "dashboard",
      source: "deep-link",
    });
    expect(parseDeepLink("userhome://open/tools")).toEqual({
      routeId: "tools",
      source: "deep-link",
    });
    expect(parseDeepLink("userhome://open/services")).toEqual({
      routeId: "services",
      source: "deep-link",
    });
    expect(parseDeepLink("userhome://open/aiConfig")).toEqual({
      routeId: "aiConfig",
      source: "deep-link",
    });
    expect(parseDeepLink("userhome://open/systemTools")).toEqual({
      routeId: "systemTools",
      source: "deep-link",
    });
    expect(parseDeepLink("userhome://open/appConfig")).toEqual({
      routeId: "appConfig",
      source: "deep-link",
    });
  });

  it("keeps a section only when the route declares it", () => {
    expect(parseDeepLink("userhome://open/environment?section=zsh")).toEqual({
      routeId: "environment",
      section: "zsh",
      source: "deep-link",
    });
    expect(parseDeepLink("userhome://open/caddy?section=rules")).toEqual({
      routeId: "caddy",
      section: "rules",
      source: "deep-link",
    });
    expect(parseDeepLink("userhome://open/caddy?section=raw")).toEqual({
      routeId: "caddy",
      section: "raw",
      source: "deep-link",
    });
  });

  it("accepts a settings group from the settings group list", () => {
    expect(parseDeepLink("userhome://open/settings?group=general")).toEqual({
      routeId: "settings",
      group: "general",
      source: "deep-link",
    });
    expect(parseDeepLink("userhome://open/settings")).toEqual({
      routeId: "settings",
      source: "deep-link",
    });
  });

  it("rejects route ids outside the whitelist, including retired and case-changed ones", () => {
    for (const link of [
      "userhome://open/applications",
      "userhome://open/homebrew",
      "userhome://open/unknown",
      "userhome://open/Dashboard",
      "userhome://open/DASHBOARD",
      "userhome://open/",
      "userhome://open",
    ]) {
      expect(parseDeepLink(link), link).toBeUndefined();
    }
  });

  it("rejects links with a different scheme or host casing", () => {
    expect(parseDeepLink("https://open/dashboard")).toBeUndefined();
    expect(parseDeepLink("USERHOME://open/dashboard")).toBeUndefined();
    expect(parseDeepLink("userhome://OPEN/dashboard")).toBeUndefined();
    expect(parseDeepLink("userhome:open/dashboard")).toBeUndefined();
  });

  it("rejects encoded and traversal path bypasses", () => {
    for (const link of [
      "userhome://open/%2e%2e/settings",
      "userhome://open/%64ashboard",
      "userhome://open/dashboard%2F",
      "userhome://open/../settings",
      "userhome://open/./dashboard",
      "userhome://open/dashboard/extra",
      "userhome://open/dashboard/",
      "userhome://open/environment?section=%64otenv",
    ]) {
      expect(parseDeepLink(link), link).toBeUndefined();
    }
  });

  it("rejects sections that the route does not declare", () => {
    expect(parseDeepLink("userhome://open/environment?section=secrets")).toBeUndefined();
    expect(parseDeepLink("userhome://open/environment?section=rules")).toBeUndefined();
    expect(parseDeepLink("userhome://open/caddy?section=launchctl")).toBeUndefined();
    expect(parseDeepLink("userhome://open/dashboard?section=dotenv")).toBeUndefined();
    expect(parseDeepLink("userhome://open/appConfig?section=dotenv")).toBeUndefined();
  });

  it("rejects settings groups outside the group list and misplaced group or section keys", () => {
    expect(parseDeepLink("userhome://open/settings?group=unknown")).toBeUndefined();
    expect(parseDeepLink("userhome://open/settings?group=General")).toBeUndefined();
    expect(parseDeepLink("userhome://open/settings?section=dotenv")).toBeUndefined();
    expect(parseDeepLink("userhome://open/environment?group=general")).toBeUndefined();
  });

  it("rejects extra, duplicate and empty query parameters", () => {
    expect(parseDeepLink("userhome://open/dashboard?foo=1")).toBeUndefined();
    expect(parseDeepLink("userhome://open/environment?section=zsh&x=1")).toBeUndefined();
    expect(parseDeepLink("userhome://open/environment?section=zsh&section=dotenv")).toBeUndefined();
    expect(parseDeepLink("userhome://open/dashboard?")).toBeUndefined();
    expect(parseDeepLink("userhome://open/environment?section=")).toBeUndefined();
    expect(parseDeepLink("userhome://open/environment?section=zsh&")).toBeUndefined();
  });

  it("rejects fragments", () => {
    expect(parseDeepLink("userhome://open/dashboard#top")).toBeUndefined();
    expect(parseDeepLink("userhome://open/environment?section=zsh#x")).toBeUndefined();
  });

  it("rejects empty, non-string and over-long input", () => {
    expect(parseDeepLink("")).toBeUndefined();
    expect(parseDeepLink(undefined)).toBeUndefined();
    expect(parseDeepLink(null)).toBeUndefined();
    expect(parseDeepLink(42)).toBeUndefined();
    const tooLong = `userhome://open/dashboard?${"section=zsh&".repeat(60)}`;
    expect(tooLong.length).toBeGreaterThan(DEEP_LINK_MAX_LENGTH);
    expect(parseDeepLink(tooLong)).toBeUndefined();
  });
});

describe("validateDeepLinkPayload", () => {
  it("accepts a payload shaped like a navigation intent and returns it from the deep-link source", () => {
    expect(
      validateDeepLinkPayload({ routeId: "environment", section: "zsh" }),
    ).toEqual({ routeId: "environment", section: "zsh", source: "deep-link" });
    expect(
      validateDeepLinkPayload({ routeId: "settings", group: "general", source: "deep-link" }),
    ).toEqual({ routeId: "settings", group: "general", source: "deep-link" });
  });

  it("rejects payloads with unknown routes, sections, groups, keys or a foreign source", () => {
    expect(validateDeepLinkPayload({ routeId: "applications" })).toBeUndefined();
    expect(validateDeepLinkPayload({ routeId: "environment", section: "secrets" })).toBeUndefined();
    expect(validateDeepLinkPayload({ routeId: "settings", group: "bogus" })).toBeUndefined();
    expect(validateDeepLinkPayload({ routeId: "dashboard", extra: true })).toBeUndefined();
    expect(validateDeepLinkPayload({ routeId: "dashboard", source: "menu" })).toBeUndefined();
    expect(validateDeepLinkPayload({ routeId: "dashboard", section: 3 })).toBeUndefined();
    expect(validateDeepLinkPayload("userhome://open/dashboard")).toBeUndefined();
    expect(validateDeepLinkPayload(null)).toBeUndefined();
  });
});

describe("buildPageDeepLink", () => {
  it("builds a link for the current page and section", () => {
    expect(buildPageDeepLink("dashboard")).toBe("userhome://open/dashboard");
    expect(buildPageDeepLink("environment", "zsh")).toBe(
      "userhome://open/environment?section=zsh",
    );
    expect(buildPageDeepLink("settings", undefined, "general")).toBe(
      "userhome://open/settings?group=general",
    );
  });

  it("returns nothing for a route outside the whitelist", () => {
    expect(buildPageDeepLink("applications")).toBeUndefined();
    expect(buildPageDeepLink("homebrew")).toBeUndefined();
  });

  it("round-trips every declared section of every whitelisted route", () => {
    for (const route of APP_ROUTES) {
      for (const section of routeSectionsOf(route.id)) {
        const link = buildPageDeepLink(route.id, section.id);
        if (link === undefined) continue;
        expect(parseDeepLink(link), link).toEqual({
          routeId: route.id,
          section: section.id,
          source: "deep-link",
        });
      }
    }
  });
});

describe("listDeepLinks", () => {
  const pages = listDeepLinks();
  const links = pages.flatMap((page) => page.rows.map((row) => row.link));

  it("lists every whitelisted page in display order", () => {
    expect(pages.map((page) => page.routeId)).toEqual(DEEP_LINK_ROUTE_IDS);
  });

  it("gives every listed link an intent that names its own page", () => {
    for (const page of pages) {
      for (const row of page.rows) {
        expect(parseDeepLink(row.link), row.link).toMatchObject({ routeId: page.routeId });
      }
    }
  });

  it("covers every page, every declared section, and every settings group", () => {
    for (const routeId of DEEP_LINK_ROUTE_IDS) {
      expect(links).toContain(`userhome://open/${routeId}`);
      for (const section of routeSectionsOf(routeId)) {
        expect(links).toContain(`userhome://open/${routeId}?section=${section.id}`);
      }
    }
    for (const group of SETTINGS_GROUPS) {
      expect(links).toContain(`userhome://open/settings?group=${group.id}`);
    }
  });

  it("lists each link once, with the settings groups in sidebar order", () => {
    expect(new Set(links).size).toBe(links.length);
    const settings = pages.find((page) => page.routeId === "settings");
    expect(settings?.rows.slice(1).map((row) => row.link)).toEqual(
      SETTINGS_GROUPS.map((group) => `userhome://open/settings?group=${group.id}`),
    );
  });
});
