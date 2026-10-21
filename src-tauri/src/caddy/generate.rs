//! Deterministic Caddyfile generation from validated site rules.
//!
//! The output is derived data: it is produced only from rules that pass
//! validation, every address is written in the explicit `http://host:port`
//! form, and automatic HTTPS is switched off so nothing is requested from the
//! network or a certificate authority.

use crate::{
    caddy::config::{CaddyRules, authority},
    error::AppError,
};

pub fn generate_caddyfile(rules: &CaddyRules) -> Result<String, AppError> {
    if rules.validate().is_blocking() {
        return Err(AppError::validation_failed(
            "规则未通过校验，未生成 Caddyfile。",
        ));
    }
    let mut text = String::from("{\n\tauto_https off\n}\n");
    for site in rules.sites.iter().filter(|site| site.enabled) {
        text.push_str("\nhttp://");
        text.push_str(&authority(&site.listen.host, site.listen.port));
        text.push_str(" {\n\treverse_proxy");
        for upstream in &site.upstreams {
            text.push(' ');
            text.push_str(upstream.scheme.as_str());
            text.push_str("://");
            text.push_str(&authority(&upstream.host, upstream.port));
        }
        text.push_str("\n}\n");
    }
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::caddy::config::{Listen, RULES_VERSION, SiteRule, Upstream, UpstreamScheme};

    fn upstream(scheme: UpstreamScheme, host: &str, port: u16) -> Upstream {
        Upstream {
            scheme,
            host: host.to_owned(),
            port,
        }
    }

    fn site(enabled: bool, host: &str, port: u16, upstreams: Vec<Upstream>) -> SiteRule {
        SiteRule {
            tls: None,
            access_log: false,
            enabled,
            listen: Listen {
                host: host.to_owned(),
                port,
            },
            upstreams,
        }
    }

    fn rules(sites: Vec<SiteRule>) -> CaddyRules {
        CaddyRules {
            version: RULES_VERSION,
            sites,
        }
    }

    fn lines(parts: &[&str]) -> String {
        let mut text = parts.join("\n");
        text.push('\n');
        text
    }

    #[test]
    fn two_sites_render_in_rule_order_with_auto_https_off() {
        let text = generate_caddyfile(&rules(vec![
            site(
                true,
                "127.0.0.1",
                8080,
                vec![upstream(UpstreamScheme::Http, "127.0.0.1", 3000)],
            ),
            site(
                true,
                "localhost",
                9090,
                vec![upstream(UpstreamScheme::Https, "example.test", 443)],
            ),
        ]))
        .expect("valid rules generate");

        assert_eq!(
            text,
            lines(&[
                "{",
                "\tauto_https off",
                "}",
                "",
                "http://127.0.0.1:8080 {",
                "\treverse_proxy http://127.0.0.1:3000",
                "}",
                "",
                "http://localhost:9090 {",
                "\treverse_proxy https://example.test:443",
                "}",
            ])
        );
    }

    #[test]
    fn ipv6_listen_is_bracketed_and_multiple_upstreams_share_one_directive() {
        let text = generate_caddyfile(&rules(vec![site(
            true,
            "::1",
            8081,
            vec![
                upstream(UpstreamScheme::Http, "127.0.0.1", 3000),
                upstream(UpstreamScheme::Https, "app.test", 8443),
                upstream(UpstreamScheme::Http, "::1", 3001),
            ],
        )]))
        .expect("valid rules generate");

        assert_eq!(
            text,
            lines(&[
                "{",
                "\tauto_https off",
                "}",
                "",
                "http://[::1]:8081 {",
                "\treverse_proxy http://127.0.0.1:3000 https://app.test:8443 http://[::1]:3001",
                "}",
            ])
        );
    }

    #[test]
    fn disabled_rules_are_skipped_without_changing_remaining_order() {
        let text = generate_caddyfile(&rules(vec![
            site(
                false,
                "127.0.0.1",
                7000,
                vec![upstream(UpstreamScheme::Http, "127.0.0.1", 3000)],
            ),
            site(
                true,
                "127.0.0.1",
                7001,
                vec![upstream(UpstreamScheme::Http, "127.0.0.1", 3001)],
            ),
            site(
                false,
                "127.0.0.1",
                7002,
                vec![upstream(UpstreamScheme::Http, "127.0.0.1", 3002)],
            ),
        ]))
        .expect("valid rules generate");

        assert!(!text.contains("7000"));
        assert!(!text.contains("7002"));
        assert!(!text.contains("3000"));
        assert!(!text.contains("3002"));
        assert_eq!(text.matches("\nhttp://").count(), 1);
        assert!(text.contains("http://127.0.0.1:7001 {"));
    }

    #[test]
    fn no_enabled_sites_yields_only_the_global_block() {
        let text = generate_caddyfile(&rules(vec![site(
            false,
            "127.0.0.1",
            8080,
            vec![upstream(UpstreamScheme::Http, "127.0.0.1", 3000)],
        )]))
        .expect("valid rules generate");

        assert_eq!(text, lines(&["{", "\tauto_https off", "}"]));
    }

    #[test]
    fn generation_is_deterministic() {
        let input = rules(vec![site(
            true,
            "127.0.0.1",
            8080,
            vec![upstream(UpstreamScheme::Http, "127.0.0.1", 3000)],
        )]);

        assert_eq!(
            generate_caddyfile(&input).expect("first"),
            generate_caddyfile(&input).expect("second")
        );
    }

    #[test]
    fn injection_attempts_are_refused_and_nothing_is_generated() {
        for host in [
            "127.0.0.1 {\n\treverse_proxy http://evil.test:1\n}\nhttp://x",
            "127.0.0.1}\nadmin 0.0.0.0:2019 {",
            "\"quoted\"",
            "a#b",
        ] {
            let result = generate_caddyfile(&rules(vec![site(
                true,
                host,
                8080,
                vec![upstream(UpstreamScheme::Http, "127.0.0.1", 3000)],
            )]));

            let error = result.expect_err("injection must be refused");
            assert_eq!(
                error.code(),
                crate::error::AppErrorCode::ValidationFailed,
                "host {host:?}"
            );
        }
    }

    #[test]
    fn upstream_injection_is_refused() {
        let result = generate_caddyfile(&rules(vec![site(
            true,
            "127.0.0.1",
            8080,
            vec![upstream(UpstreamScheme::Http, "127.0.0.1 } evil {", 3000)],
        )]));

        assert!(result.is_err());
    }

    #[test]
    fn enabled_conflict_refuses_generation() {
        let result = generate_caddyfile(&rules(vec![
            site(
                true,
                "127.0.0.1",
                8080,
                vec![upstream(UpstreamScheme::Http, "127.0.0.1", 3000)],
            ),
            site(
                true,
                "127.0.0.1",
                8080,
                vec![upstream(UpstreamScheme::Http, "127.0.0.1", 3001)],
            ),
        ]));

        assert!(result.is_err());
    }

    #[test]
    fn output_never_contains_addresses_other_than_explicit_http_sites() {
        let text = generate_caddyfile(&rules(vec![site(
            true,
            "0.0.0.0",
            8080,
            vec![upstream(UpstreamScheme::Http, "127.0.0.1", 3000)],
        )]))
        .expect("valid rules generate");

        let site_lines: Vec<&str> = text
            .lines()
            .filter(|line| !line.starts_with('\t') && line.ends_with(" {"))
            .collect();
        assert_eq!(site_lines, vec!["http://0.0.0.0:8080 {"]);
        assert!(!text.contains("tls"));
        assert!(!text.contains("admin"));
    }
}
