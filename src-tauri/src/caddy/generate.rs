//! Deterministic Caddyfile generation from validated site rules.
//!
//! The output is derived data: it is produced only from rules that pass
//! validation, every address is written in the explicit form, and automatic
//! HTTPS is switched off so nothing is requested from the network or a
//! certificate authority. A TLS site uses only the certificate and key files
//! that the caller resolved from the user's authorizations.

use crate::{
    caddy::{
        config::{CaddyRules, TlsConfig, authority},
        tls::{TlsPaths, caddy_safe_path},
    },
    error::AppError,
};

pub fn generate_caddyfile(rules: &CaddyRules) -> Result<String, AppError> {
    generate_caddyfile_with_tls(rules, &|_: &TlsConfig| {
        Err(AppError::validation_failed(
            "TLS 站点需要先选择证书与私钥授权，未生成 Caddyfile。",
        ))
    })
}

pub fn generate_caddyfile_with_tls(
    rules: &CaddyRules,
    resolve: &dyn Fn(&TlsConfig) -> Result<TlsPaths, AppError>,
) -> Result<String, AppError> {
    if rules.validate().is_blocking() {
        return Err(AppError::validation_failed(
            "规则未通过校验，未生成 Caddyfile。",
        ));
    }
    let mut text = String::from("{\n\tauto_https off\n}\n");
    for site in rules.sites.iter().filter(|site| site.enabled) {
        let scheme = if site.tls.is_some() { "https" } else { "http" };
        text.push('\n');
        text.push_str(scheme);
        text.push_str("://");
        text.push_str(&authority(&site.listen.host, site.listen.port));
        text.push_str(" {");
        if let Some(tls) = &site.tls {
            let paths = resolve(tls)?;
            text.push_str("\n\ttls ");
            text.push_str(caddy_safe_path(&paths.certificate)?);
            text.push(' ');
            text.push_str(caddy_safe_path(&paths.private_key)?);
        }
        if site.access_log {
            text.push_str("\n\tlog");
        }
        text.push_str("\n\treverse_proxy");
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
    use crate::error::AppErrorCode;
    use std::path::PathBuf;

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

    const CERT: &str = "3f2b8c1e-6a4d-4b7e-9c2f-1a2b3c4d5e6f";
    const KEY: &str = "7c9d0e1f-2a3b-4c5d-8e6f-7a8b9c0d1e2f";

    fn tls_config() -> TlsConfig {
        TlsConfig {
            certificate_grant_id: CERT.to_owned(),
            private_key_grant_id: KEY.to_owned(),
        }
    }

    fn tls_site(host: &str, port: u16, access_log: bool) -> SiteRule {
        SiteRule {
            tls: Some(tls_config()),
            access_log,
            ..site(
                true,
                host,
                port,
                vec![upstream(UpstreamScheme::Http, "127.0.0.1", 3000)],
            )
        }
    }

    fn resolve_to(
        certificate: &str,
        private_key: &str,
    ) -> impl Fn(&TlsConfig) -> Result<TlsPaths, AppError> {
        let certificate = PathBuf::from(certificate);
        let private_key = PathBuf::from(private_key);
        move |_: &TlsConfig| {
            Ok(TlsPaths {
                certificate: certificate.clone(),
                private_key: private_key.clone(),
            })
        }
    }

    #[test]
    fn tls_site_uses_https_with_the_resolved_certificate_and_key() {
        let text = generate_caddyfile_with_tls(
            &rules(vec![tls_site("app.example.test", 8443, false)]),
            &resolve_to("/Users/u/certs/cert.pem", "/Users/u/certs/key.pem"),
        )
        .expect("valid rules generate");

        assert_eq!(
            text,
            lines(&[
                "{",
                "\tauto_https off",
                "}",
                "",
                "https://app.example.test:8443 {",
                "\ttls /Users/u/certs/cert.pem /Users/u/certs/key.pem",
                "\treverse_proxy http://127.0.0.1:3000",
                "}",
            ])
        );
    }

    #[test]
    fn access_log_adds_one_log_directive_before_the_proxy() {
        let text =
            generate_caddyfile(&rules(vec![logged_http_site()])).expect("valid rules generate");

        assert_eq!(
            text,
            lines(&[
                "{",
                "\tauto_https off",
                "}",
                "",
                "http://127.0.0.1:8080 {",
                "\tlog",
                "\treverse_proxy http://127.0.0.1:3000",
                "}",
            ])
        );
    }

    fn logged_http_site() -> SiteRule {
        SiteRule {
            access_log: true,
            ..site(
                true,
                "127.0.0.1",
                8080,
                vec![upstream(UpstreamScheme::Http, "127.0.0.1", 3000)],
            )
        }
    }

    #[test]
    fn tls_and_access_log_together_put_tls_before_log() {
        let text = generate_caddyfile_with_tls(
            &rules(vec![tls_site("localhost", 9443, true)]),
            &resolve_to("/x/cert.pem", "/x/key.pem"),
        )
        .expect("valid rules generate");

        assert_eq!(
            text,
            lines(&[
                "{",
                "\tauto_https off",
                "}",
                "",
                "https://localhost:9443 {",
                "\ttls /x/cert.pem /x/key.pem",
                "\tlog",
                "\treverse_proxy http://127.0.0.1:3000",
                "}",
            ])
        );
    }

    #[test]
    fn tls_site_without_a_resolver_result_is_never_generated() {
        let result = generate_caddyfile(&rules(vec![tls_site("localhost", 9443, false)]));

        assert!(result.is_err());
    }

    #[test]
    fn resolution_failure_for_a_revoked_authorization_refuses_generation() {
        let result = generate_caddyfile_with_tls(
            &rules(vec![tls_site("localhost", 9443, false)]),
            &|_: &TlsConfig| Err(AppError::not_found("证书授权已撤销")),
        );

        assert!(result.is_err());
    }

    #[test]
    fn disabled_tls_site_is_not_resolved() {
        let mut disabled = tls_site("localhost", 9443, false);
        disabled.enabled = false;
        let text = generate_caddyfile_with_tls(&rules(vec![disabled]), &|_: &TlsConfig| {
            Err(AppError::not_found("证书授权已撤销"))
        })
        .expect("disabled sites are not resolved");

        assert!(!text.contains("tls"));
        assert!(!text.contains("https://"));
    }

    #[test]
    fn unsafe_tls_paths_are_refused_for_either_file() {
        for (certificate, private_key) in [
            ("/x/with space.pem", "/x/key.pem"),
            ("/x/cert.pem", "/x/{env.HOME}.pem"),
            ("relative/cert.pem", "/x/key.pem"),
            ("/x/cert.pem", "/x/key\"quote.pem"),
            ("/x/cert.pem", "/x/key#hash.pem"),
        ] {
            let result = generate_caddyfile_with_tls(
                &rules(vec![tls_site("localhost", 9443, false)]),
                &resolve_to(certificate, private_key),
            );

            let error = result.expect_err("unsafe path must be refused");
            assert_eq!(
                error.code(),
                AppErrorCode::ValidationFailed,
                "{certificate} / {private_key}"
            );
        }
    }

    #[test]
    fn http_only_rules_ignore_the_resolver_and_match_the_plain_generator() {
        let input = rules(vec![logged_http_site()]);
        let plain = generate_caddyfile(&input).expect("plain");
        let with_resolver = generate_caddyfile_with_tls(&input, &|_: &TlsConfig| {
            Err(AppError::not_found("unused"))
        })
        .expect("resolver not called for http sites");

        assert_eq!(plain, with_resolver);
    }
}
