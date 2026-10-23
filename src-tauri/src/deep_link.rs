use std::sync::{Mutex, MutexGuard};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

pub const DEEP_LINK_EVENT: &str = "deep-link://navigate";

const LINK_PREFIX: &str = "userhome://open/";
const MAX_LINK_LENGTH: usize = 512;
const SOURCE: &str = "deep-link";

struct RouteSpec {
    id: &'static str,
    sections: &'static [&'static str],
}

const ROUTES: &[RouteSpec] = &[
    RouteSpec {
        id: "dashboard",
        sections: &[],
    },
    RouteSpec {
        id: "environment",
        sections: &["dotenv", "zsh", "launchctl"],
    },
    RouteSpec {
        id: "appConfig",
        sections: &[],
    },
    RouteSpec {
        id: "aiConfig",
        sections: &[],
    },
    RouteSpec {
        id: "systemTools",
        sections: &[],
    },
    RouteSpec {
        id: "tools",
        sections: &[],
    },
    RouteSpec {
        id: "services",
        sections: &[],
    },
    RouteSpec {
        id: "settings",
        sections: &[],
    },
    RouteSpec {
        id: "caddy",
        sections: &["rules", "run", "raw"],
    },
];

const SETTINGS_GROUPS: &[&str] = &[
    "appearance",
    "general",
    "refresh",
    "configuration",
    "privacy",
    "diagnostics",
    "reset",
];

/// Navigation only. Every field is a whitelisted static string, never text copied from the link.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NavigationIntent {
    route_id: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    section: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    group: Option<&'static str>,
    source: &'static str,
}

/// The most recent valid link, kept until the frontend takes it after startup.
#[derive(Default)]
pub struct PendingDeepLink(Mutex<Option<NavigationIntent>>);

impl PendingDeepLink {
    fn slot(&self) -> MutexGuard<'_, Option<NavigationIntent>> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn store(&self, intent: NavigationIntent) {
        *self.slot() = Some(intent);
    }

    pub fn take(&self) -> Option<NavigationIntent> {
        self.slot().take()
    }
}

fn is_token(value: &str) -> bool {
    !value.is_empty() && value.bytes().all(|byte| byte.is_ascii_alphabetic())
}

/// Strict whitelist parse of a `userhome://open/<route>[?section=..|group=..]` link.
/// Nothing is decoded; anything outside the tables yields `None`.
pub fn parse(link: &str) -> Option<NavigationIntent> {
    if link.is_empty() || link.len() > MAX_LINK_LENGTH {
        return None;
    }
    let rest = link.strip_prefix(LINK_PREFIX)?;
    let (route_text, query) = match rest.split_once('?') {
        Some((route, query)) => (route, Some(query)),
        None => (rest, None),
    };
    let route = ROUTES.iter().find(|spec| spec.id == route_text)?;

    let mut section: Option<&str> = None;
    let mut group: Option<&str> = None;
    if let Some(query) = query {
        for pair in query.split('&') {
            let (key, value) = pair.split_once('=')?;
            if !is_token(value) {
                return None;
            }
            match key {
                "section" if section.is_none() => section = Some(value),
                "group" if group.is_none() => group = Some(value),
                _ => return None,
            }
        }
    }
    resolve(route, section, group)
}

fn resolve(
    route: &RouteSpec,
    section: Option<&str>,
    group: Option<&str>,
) -> Option<NavigationIntent> {
    let (section, group) = if route.id == "settings" {
        if section.is_some() {
            return None;
        }
        let group = match group {
            Some(value) => Some(SETTINGS_GROUPS.iter().copied().find(|id| *id == value)?),
            None => None,
        };
        (None, group)
    } else {
        if group.is_some() {
            return None;
        }
        let section = match section {
            Some(value) => Some(route.sections.iter().copied().find(|id| *id == value)?),
            None => None,
        };
        (section, None)
    };
    Some(NavigationIntent {
        route_id: route.id,
        section,
        group,
        source: SOURCE,
    })
}

/// Shows the main window for every opened URL; only the latest valid link navigates.
pub fn handle_opened<'a>(app: &AppHandle, links: impl IntoIterator<Item = &'a str>) {
    if let Some(intent) = links.into_iter().filter_map(parse).last() {
        app.state::<PendingDeepLink>().store(intent.clone());
        if let Err(error) = app.emit(DEEP_LINK_EVENT, intent) {
            eprintln!("failed to emit deep link navigation: {error}");
        }
    }
    crate::tray::show_main_window(app);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn route_of(link: &str) -> Option<&'static str> {
        parse(link).map(|intent| intent.route_id)
    }

    #[test]
    fn accepts_every_whitelisted_route() {
        for id in [
            "dashboard",
            "environment",
            "appConfig",
            "aiConfig",
            "systemTools",
            "tools",
            "services",
            "settings",
            "caddy",
        ] {
            assert_eq!(route_of(&format!("userhome://open/{id}")), Some(id));
        }
    }

    #[test]
    fn keeps_declared_sections_and_groups() {
        let environment = parse("userhome://open/environment?section=zsh").expect("valid");
        assert_eq!(environment.section, Some("zsh"));
        assert_eq!(environment.group, None);
        let caddy = parse("userhome://open/caddy?section=rules").expect("valid");
        assert_eq!(caddy.section, Some("rules"));
        let settings = parse("userhome://open/settings?group=general").expect("valid");
        assert_eq!(settings.group, Some("general"));
        assert_eq!(settings.source, "deep-link");
    }

    #[test]
    fn rejects_unknown_and_retired_routes_and_wrong_case() {
        for link in [
            "userhome://open/applications",
            "userhome://open/homebrew",
            "userhome://open/unknown",
            "userhome://open/Dashboard",
            "userhome://open/",
            "userhome://open",
            "https://open/dashboard",
        ] {
            assert_eq!(parse(link), None, "{link}");
        }
    }

    #[test]
    fn rejects_encoded_traversal_and_fragments() {
        for link in [
            "userhome://open/%2e%2e/settings",
            "userhome://open/%64ashboard",
            "userhome://open/../settings",
            "userhome://open/dashboard/extra",
            "userhome://open/dashboard#top",
            "userhome://open/environment?section=%64otenv",
        ] {
            assert_eq!(parse(link), None, "{link}");
        }
    }

    #[test]
    fn rejects_sections_groups_and_extra_or_duplicate_parameters() {
        for link in [
            "userhome://open/environment?section=secrets",
            "userhome://open/caddy?section=launchctl",
            "userhome://open/dashboard?section=dotenv",
            "userhome://open/settings?group=unknown",
            "userhome://open/settings?section=dotenv",
            "userhome://open/environment?group=general",
            "userhome://open/dashboard?foo=1",
            "userhome://open/environment?section=zsh&section=dotenv",
            "userhome://open/environment?section=zsh&x=1",
            "userhome://open/dashboard?",
            "userhome://open/environment?section=",
        ] {
            assert_eq!(parse(link), None, "{link}");
        }
    }

    #[test]
    fn rejects_empty_and_over_long_input() {
        assert_eq!(parse(""), None);
        let too_long = format!("userhome://open/dashboard?{}", "section=zsh&".repeat(60));
        assert!(too_long.len() > MAX_LINK_LENGTH);
        assert_eq!(parse(&too_long), None);
    }

    #[test]
    fn pending_link_keeps_only_the_latest_and_is_taken_once() {
        let pending = PendingDeepLink::default();
        pending.store(parse("userhome://open/tools").expect("valid"));
        pending.store(parse("userhome://open/aiConfig").expect("valid"));
        assert_eq!(
            pending.take().map(|intent| intent.route_id),
            Some("aiConfig")
        );
        assert_eq!(pending.take(), None);
    }
}
