//! Structured site rules for the UserHome-owned Caddy configuration.
//!
//! The rules are the source of truth; the Caddyfile is derived from them. Every
//! host, port and upstream is checked against a closed grammar before it can
//! reach the generator, so no input can add a directive or a block.

use std::{collections::BTreeMap, net::IpAddr};

use serde::{Deserialize, Serialize};

use crate::grants::GrantId;

pub const RULES_VERSION: u32 = 1;
pub const MAX_SITES: usize = 32;
pub const MAX_UPSTREAMS: usize = 8;
const PRIVILEGED_PORT_LIMIT: u16 = 1024;
const MAX_HOST_BYTES: usize = 253;
const MAX_LABEL_BYTES: usize = 63;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CaddyRules {
    pub version: u32,
    pub sites: Vec<SiteRule>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SiteRule {
    pub enabled: bool,
    pub listen: Listen,
    pub upstreams: Vec<Upstream>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tls: Option<TlsConfig>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub access_log: bool,
}

/// References to a user-picked certificate and private key. Only the
/// authorization ids are stored; the backend resolves the paths and never
/// reads the key content.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TlsConfig {
    pub certificate_grant_id: String,
    pub private_key_grant_id: String,
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Listen {
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Upstream {
    pub scheme: UpstreamScheme,
    pub host: String,
    pub port: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UpstreamScheme {
    Http,
    Https,
}

impl UpstreamScheme {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Http => "http",
            Self::Https => "https",
        }
    }
}

impl CaddyRules {
    pub fn enabled_tls(&self) -> Vec<TlsConfig> {
        self.sites
            .iter()
            .filter(|site| site.enabled)
            .filter_map(|site| site.tls.clone())
            .collect()
    }

    pub fn example() -> Self {
        Self {
            version: RULES_VERSION,
            sites: vec![SiteRule {
                tls: None,
                access_log: false,
                enabled: true,
                listen: Listen {
                    host: "127.0.0.1".to_owned(),
                    port: 8080,
                },
                upstreams: vec![Upstream {
                    scheme: UpstreamScheme::Http,
                    host: "127.0.0.1".to_owned(),
                    port: 3000,
                }],
            }],
        }
    }

    pub fn validate(&self) -> RulesValidation {
        let mut issues = Vec::new();
        let mut exposures = Vec::new();
        let mut enabled_listens: BTreeMap<(String, u16), Vec<usize>> = BTreeMap::new();
        if self.version != RULES_VERSION {
            issues.push(Issue::new(
                IssueCode::UnsupportedVersion,
                None,
                None,
                Some("version"),
            ));
        }
        if self.sites.len() > MAX_SITES {
            issues.push(Issue::new(
                IssueCode::TooManySites,
                None,
                None,
                Some("sites"),
            ));
        }
        for (site_index, site) in self.sites.iter().enumerate() {
            let host = check_listen(&site.listen, site_index, &mut issues);
            check_tls(site.tls.as_ref(), host.as_ref(), site_index, &mut issues);
            if site.upstreams.is_empty() {
                issues.push(Issue::new(
                    IssueCode::NoUpstream,
                    Some(site_index),
                    None,
                    Some("upstreams"),
                ));
            }
            if site.upstreams.len() > MAX_UPSTREAMS {
                issues.push(Issue::new(
                    IssueCode::TooManyUpstreams,
                    Some(site_index),
                    None,
                    Some("upstreams"),
                ));
            }
            for (upstream_index, upstream) in site.upstreams.iter().enumerate() {
                check_upstream(upstream, site_index, upstream_index, &mut issues);
            }
            if let Some(host) = host
                && site.enabled
            {
                let (visible_externally, reason) = host.exposure();
                exposures.push(Exposure {
                    site: site_index,
                    listen: authority(&host.key(), site.listen.port),
                    visible_externally,
                    reason,
                });
                enabled_listens
                    .entry((host.key(), site.listen.port))
                    .or_default()
                    .push(site_index);
            }
        }
        let conflicts = enabled_listens
            .into_iter()
            .filter(|(_, sites)| sites.len() > 1)
            .map(|((host, port), sites)| Conflict {
                listen: authority(&host, port),
                sites,
            })
            .collect();
        RulesValidation {
            issues,
            conflicts,
            exposures,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Severity {
    Error,
    Warning,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IssueCode {
    UnsupportedVersion,
    TooManySites,
    NoUpstream,
    TooManyUpstreams,
    InvalidHost,
    ForbiddenCharacter,
    InvalidPort,
    PrivilegedPort,
    InvalidTlsGrant,
    TlsIpAddress,
}

impl IssueCode {
    fn severity(self) -> Severity {
        match self {
            Self::PrivilegedPort | Self::TlsIpAddress => Severity::Warning,
            _ => Severity::Error,
        }
    }

    fn message(self) -> &'static str {
        match self {
            Self::UnsupportedVersion => "规则版本不受支持。",
            Self::TooManySites => "站点规则数量超过上限。",
            Self::NoUpstream => "每个站点至少需要一个上游。",
            Self::TooManyUpstreams => "单个站点的上游数量超过上限。",
            Self::InvalidHost => {
                "主机不合法：只允许 IPv4 或 IPv6 字面量、localhost 或由字母、数字和连字符组成的域名。"
            }
            Self::ForbiddenCharacter => {
                "主机包含不允许的字符（空白、花括号、引号、#、反引号、反斜杠或控制字符）。"
            }
            Self::InvalidPort => "端口必须在 1 到 65535 之间。",
            Self::PrivilegedPort => "端口小于 1024 属于特权端口，普通用户通常无法绑定。",
            Self::InvalidTlsGrant => "TLS 证书或私钥授权无效，请重新选择文件。",
            Self::TlsIpAddress => {
                "TLS 站点使用 IP 地址：证书需包含该 IP 的 SAN 才能被信任，应用未检查证书内容。"
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Issue {
    pub code: IssueCode,
    pub severity: Severity,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub site: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub upstream: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<&'static str>,
    pub message: &'static str,
}

impl Issue {
    fn new(
        code: IssueCode,
        site: Option<usize>,
        upstream: Option<usize>,
        field: Option<&'static str>,
    ) -> Self {
        Self {
            code,
            severity: code.severity(),
            site,
            upstream,
            field,
            message: code.message(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Conflict {
    pub listen: String,
    pub sites: Vec<usize>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExposureReason {
    Loopback,
    AllInterfaces,
    NonLoopbackAddress,
    HostName,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Exposure {
    pub site: usize,
    pub listen: String,
    pub visible_externally: bool,
    pub reason: ExposureReason,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RulesValidation {
    pub issues: Vec<Issue>,
    pub conflicts: Vec<Conflict>,
    pub exposures: Vec<Exposure>,
}

impl RulesValidation {
    pub fn is_blocking(&self) -> bool {
        !self.conflicts.is_empty()
            || self
                .issues
                .iter()
                .any(|issue| issue.severity == Severity::Error)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum HostKind {
    Ip(IpAddr),
    Localhost,
    Name(String),
}

impl HostKind {
    pub(crate) fn key(&self) -> String {
        match self {
            Self::Ip(ip) => ip.to_string(),
            Self::Localhost => "localhost".to_owned(),
            Self::Name(name) => name.clone(),
        }
    }

    fn exposure(&self) -> (bool, ExposureReason) {
        match self {
            Self::Ip(ip) if ip.is_unspecified() => (true, ExposureReason::AllInterfaces),
            Self::Ip(ip) if ip.is_loopback() => (false, ExposureReason::Loopback),
            Self::Ip(_) => (true, ExposureReason::NonLoopbackAddress),
            Self::Localhost => (false, ExposureReason::Loopback),
            Self::Name(_) => (true, ExposureReason::HostName),
        }
    }
}

pub(crate) fn parse_host(raw: &str) -> Result<HostKind, IssueCode> {
    if raw.chars().any(is_forbidden_char) {
        return Err(IssueCode::ForbiddenCharacter);
    }
    if let Ok(ip) = raw.parse::<IpAddr>() {
        return Ok(HostKind::Ip(ip));
    }
    if raw.eq_ignore_ascii_case("localhost") {
        return Ok(HostKind::Localhost);
    }
    let lowered = raw.to_ascii_lowercase();
    if is_domain_name(&lowered) {
        Ok(HostKind::Name(lowered))
    } else {
        Err(IssueCode::InvalidHost)
    }
}

pub(crate) fn authority(host: &str, port: u16) -> String {
    if host.contains(':') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
}

fn is_forbidden_char(character: char) -> bool {
    character.is_control()
        || character.is_whitespace()
        || matches!(character, '{' | '}' | '"' | '\'' | '`' | '#' | '\\')
}

fn is_domain_name(value: &str) -> bool {
    if value.len() > MAX_HOST_BYTES {
        return false;
    }
    let labels: Vec<&str> = value.split('.').collect();
    let labels_valid = labels.iter().all(|label| {
        !label.is_empty()
            && label.len() <= MAX_LABEL_BYTES
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
    });
    // A dotted all-numeric name is an IPv4 address that failed to parse, not a domain.
    let last_label_numeric = labels
        .last()
        .is_some_and(|label| label.bytes().all(|byte| byte.is_ascii_digit()));
    labels_valid && !last_label_numeric
}

fn check_listen(listen: &Listen, site_index: usize, issues: &mut Vec<Issue>) -> Option<HostKind> {
    let host = match parse_host(&listen.host) {
        Ok(host) => Some(host),
        Err(code) => {
            issues.push(Issue::new(
                code,
                Some(site_index),
                None,
                Some("listen.host"),
            ));
            None
        }
    };
    if listen.port == 0 {
        issues.push(Issue::new(
            IssueCode::InvalidPort,
            Some(site_index),
            None,
            Some("listen.port"),
        ));
    } else if listen.port < PRIVILEGED_PORT_LIMIT {
        issues.push(Issue::new(
            IssueCode::PrivilegedPort,
            Some(site_index),
            None,
            Some("listen.port"),
        ));
    }
    host
}

fn check_tls(
    tls: Option<&TlsConfig>,
    host: Option<&HostKind>,
    site_index: usize,
    issues: &mut Vec<Issue>,
) {
    let Some(tls) = tls else {
        return;
    };
    if GrantId::parse(&tls.certificate_grant_id).is_err() {
        issues.push(Issue::new(
            IssueCode::InvalidTlsGrant,
            Some(site_index),
            None,
            Some("tls.certificateGrantId"),
        ));
    }
    if GrantId::parse(&tls.private_key_grant_id).is_err()
        || tls.private_key_grant_id == tls.certificate_grant_id
    {
        issues.push(Issue::new(
            IssueCode::InvalidTlsGrant,
            Some(site_index),
            None,
            Some("tls.privateKeyGrantId"),
        ));
    }
    if matches!(host, Some(HostKind::Ip(_))) {
        issues.push(Issue::new(
            IssueCode::TlsIpAddress,
            Some(site_index),
            None,
            Some("listen.host"),
        ));
    }
}

fn check_upstream(
    upstream: &Upstream,
    site_index: usize,
    upstream_index: usize,
    issues: &mut Vec<Issue>,
) {
    if let Err(code) = parse_host(&upstream.host) {
        issues.push(Issue::new(
            code,
            Some(site_index),
            Some(upstream_index),
            Some("upstreams.host"),
        ));
    }
    if upstream.port == 0 {
        issues.push(Issue::new(
            IssueCode::InvalidPort,
            Some(site_index),
            Some(upstream_index),
            Some("upstreams.port"),
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn listen(host: &str, port: u16) -> Listen {
        Listen {
            host: host.to_owned(),
            port,
        }
    }

    fn upstream(host: &str, port: u16) -> Upstream {
        Upstream {
            scheme: UpstreamScheme::Http,
            host: host.to_owned(),
            port,
        }
    }

    fn site(enabled: bool, host: &str, port: u16) -> SiteRule {
        SiteRule {
            tls: None,
            access_log: false,
            enabled,
            listen: listen(host, port),
            upstreams: vec![upstream("127.0.0.1", 3000)],
        }
    }

    fn rules(sites: Vec<SiteRule>) -> CaddyRules {
        CaddyRules {
            version: RULES_VERSION,
            sites,
        }
    }

    fn codes(validation: &RulesValidation) -> Vec<IssueCode> {
        validation.issues.iter().map(|issue| issue.code).collect()
    }

    #[test]
    fn example_rule_is_valid_loopback_and_not_blocking() {
        let validation = CaddyRules::example().validate();

        assert!(validation.issues.is_empty());
        assert!(validation.conflicts.is_empty());
        assert!(!validation.is_blocking());
        assert_eq!(
            validation.exposures,
            vec![Exposure {
                site: 0,
                listen: "127.0.0.1:8080".to_owned(),
                visible_externally: false,
                reason: ExposureReason::Loopback,
            }]
        );
    }

    #[test]
    fn accepts_ipv4_ipv6_localhost_and_domain_hosts() {
        for host in [
            "127.0.0.1",
            "::1",
            "localhost",
            "LOCALHOST",
            "app.example.test",
            "devbox",
        ] {
            let validation = rules(vec![site(true, host, 8080)]).validate();

            assert!(
                validation.issues.is_empty(),
                "host {host} should be accepted, got {:?}",
                validation.issues
            );
        }
    }

    #[test]
    fn rejects_injection_characters_in_listen_host() {
        for host in [
            "127.0.0.1 {",
            "127.0.0.1}",
            "a\nb",
            "a\rb",
            "a\tb",
            "a b",
            "\"quoted\"",
            "'single'",
            "`tick`",
            "host#comment",
            "a\\b",
            "nul\u{0}byte",
            "bell\u{7}",
        ] {
            let validation = rules(vec![site(true, host, 8080)]).validate();

            assert_eq!(
                codes(&validation),
                vec![IssueCode::ForbiddenCharacter],
                "host {host:?} must be refused as forbidden"
            );
            assert!(validation.is_blocking());
        }
    }

    #[test]
    fn rejects_injection_characters_in_upstream_host() {
        let mut site = site(true, "127.0.0.1", 8080);
        site.upstreams = vec![upstream("127.0.0.1 } reverse_proxy evil", 3000)];
        let validation = rules(vec![site]).validate();

        assert_eq!(codes(&validation), vec![IssueCode::ForbiddenCharacter]);
        assert_eq!(validation.issues[0].field, Some("upstreams.host"));
        assert_eq!(validation.issues[0].upstream, Some(0));
    }

    #[test]
    fn rejects_malformed_hosts_outside_the_forbidden_set() {
        for host in [
            "",
            "fe80::1%en0",
            "[::1]",
            "example_test.com",
            "例子.test",
            "-leading.example",
            "trailing-.example",
            "double..dot",
            "trailing.dot.",
            "999.1.1.1",
            "a.123",
            "under_score",
            "256.256.256.256",
        ] {
            let validation = rules(vec![site(true, host, 8080)]).validate();

            assert_eq!(
                codes(&validation),
                vec![IssueCode::InvalidHost],
                "host {host:?} must be refused as invalid"
            );
        }
    }

    #[test]
    fn rejects_overlong_domain_and_label() {
        let long_label = format!("{}.test", "a".repeat(64));
        let long_name = format!("{}.test", vec!["abcdefgh"; 29].join("."));
        assert!(long_name.len() > MAX_HOST_BYTES);

        for host in [long_label.as_str(), long_name.as_str()] {
            let validation = rules(vec![site(true, host, 8080)]).validate();

            assert_eq!(codes(&validation), vec![IssueCode::InvalidHost]);
        }
    }

    #[test]
    fn accepts_label_at_the_length_limit() {
        let label = "a".repeat(63);
        let validation = rules(vec![site(true, &format!("{label}.test"), 8080)]).validate();

        assert!(validation.issues.is_empty());
    }

    #[test]
    fn port_zero_is_refused_and_privileged_ports_only_warn() {
        let zero = rules(vec![site(true, "127.0.0.1", 0)]).validate();
        assert_eq!(codes(&zero), vec![IssueCode::InvalidPort]);
        assert!(zero.is_blocking());

        let privileged = rules(vec![site(true, "127.0.0.1", 80)]).validate();
        assert_eq!(codes(&privileged), vec![IssueCode::PrivilegedPort]);
        assert_eq!(privileged.issues[0].severity, Severity::Warning);
        assert!(!privileged.is_blocking());

        let boundary = rules(vec![site(true, "127.0.0.1", 1024)]).validate();
        assert!(boundary.issues.is_empty());

        let highest = rules(vec![site(true, "127.0.0.1", 65535)]).validate();
        assert!(highest.issues.is_empty());
    }

    #[test]
    fn upstream_port_zero_is_refused() {
        let mut site = site(true, "127.0.0.1", 8080);
        site.upstreams = vec![upstream("127.0.0.1", 0)];
        let validation = rules(vec![site]).validate();

        assert_eq!(codes(&validation), vec![IssueCode::InvalidPort]);
        assert_eq!(validation.issues[0].field, Some("upstreams.port"));
    }

    #[test]
    fn site_without_upstream_and_with_too_many_upstreams_are_refused() {
        let mut empty = site(true, "127.0.0.1", 8080);
        empty.upstreams = Vec::new();
        assert_eq!(
            codes(&rules(vec![empty]).validate()),
            vec![IssueCode::NoUpstream]
        );

        let mut crowded = site(true, "127.0.0.1", 8080);
        crowded.upstreams = (0..=MAX_UPSTREAMS)
            .map(|index| upstream("127.0.0.1", 3000 + index as u16))
            .collect();
        assert_eq!(
            codes(&rules(vec![crowded]).validate()),
            vec![IssueCode::TooManyUpstreams]
        );
    }

    #[test]
    fn site_count_limit_is_enforced() {
        let sites = (0..=MAX_SITES)
            .map(|index| site(false, "127.0.0.1", 9000 + index as u16))
            .collect();
        let validation = rules(sites).validate();

        assert_eq!(codes(&validation), vec![IssueCode::TooManySites]);
    }

    #[test]
    fn unsupported_version_is_refused() {
        let validation = CaddyRules {
            version: 2,
            sites: vec![site(true, "127.0.0.1", 8080)],
        }
        .validate();

        assert_eq!(codes(&validation), vec![IssueCode::UnsupportedVersion]);
        assert!(validation.is_blocking());
    }

    #[test]
    fn disabled_invalid_rule_still_blocks_save() {
        let validation = rules(vec![site(false, "127.0.0.1 {", 8080)]).validate();

        assert!(validation.is_blocking());
        assert!(validation.exposures.is_empty());
    }

    #[test]
    fn enabled_duplicate_listen_is_a_structured_conflict() {
        let validation = rules(vec![
            site(true, "127.0.0.1", 8080),
            site(true, "127.0.0.1", 9090),
            site(true, "127.0.0.1", 8080),
        ])
        .validate();

        assert_eq!(
            validation.conflicts,
            vec![Conflict {
                listen: "127.0.0.1:8080".to_owned(),
                sites: vec![0, 2],
            }]
        );
        assert!(validation.is_blocking());
    }

    #[test]
    fn duplicate_detection_normalizes_ipv6_and_domain_case() {
        let ipv6 = rules(vec![
            site(true, "::1", 8080),
            site(true, "0:0:0:0:0:0:0:1", 8080),
        ])
        .validate();
        assert_eq!(
            ipv6.conflicts,
            vec![Conflict {
                listen: "[::1]:8080".to_owned(),
                sites: vec![0, 1],
            }]
        );

        let localhost = rules(vec![
            site(true, "localhost", 8080),
            site(true, "LocalHost", 8080),
        ])
        .validate();
        assert_eq!(localhost.conflicts.len(), 1);

        let domain = rules(vec![
            site(true, "App.Example.test", 8080),
            site(true, "app.example.test", 8080),
        ])
        .validate();
        assert_eq!(domain.conflicts.len(), 1);
    }

    #[test]
    fn disabled_duplicate_is_not_a_conflict() {
        let validation = rules(vec![
            site(true, "127.0.0.1", 8080),
            site(false, "127.0.0.1", 8080),
        ])
        .validate();

        assert!(validation.conflicts.is_empty());
        assert!(!validation.is_blocking());
    }

    #[test]
    fn different_ports_on_same_host_do_not_conflict() {
        let validation = rules(vec![
            site(true, "127.0.0.1", 8080),
            site(true, "127.0.0.1", 8081),
        ])
        .validate();

        assert!(validation.conflicts.is_empty());
    }

    #[test]
    fn loopback_hosts_are_not_externally_visible() {
        for (host, expected_reason) in [
            ("127.0.0.1", ExposureReason::Loopback),
            ("127.0.0.2", ExposureReason::Loopback),
            ("::1", ExposureReason::Loopback),
            ("localhost", ExposureReason::Loopback),
        ] {
            let validation = rules(vec![site(true, host, 8080)]).validate();

            assert_eq!(validation.exposures.len(), 1, "host {host}");
            assert!(!validation.exposures[0].visible_externally, "host {host}");
            assert_eq!(
                validation.exposures[0].reason, expected_reason,
                "host {host}"
            );
        }
    }

    #[test]
    fn wildcard_addresses_are_externally_visible() {
        for host in ["0.0.0.0", "::"] {
            let validation = rules(vec![site(true, host, 8080)]).validate();

            assert!(validation.exposures[0].visible_externally, "host {host}");
            assert_eq!(
                validation.exposures[0].reason,
                ExposureReason::AllInterfaces
            );
        }
    }

    #[test]
    fn lan_addresses_and_names_are_externally_visible() {
        let lan = rules(vec![site(true, "192.168.1.10", 8080)]).validate();
        assert!(lan.exposures[0].visible_externally);
        assert_eq!(lan.exposures[0].reason, ExposureReason::NonLoopbackAddress);

        let v6 = rules(vec![site(true, "fd00::5", 8080)]).validate();
        assert!(v6.exposures[0].visible_externally);
        assert_eq!(v6.exposures[0].reason, ExposureReason::NonLoopbackAddress);

        let name = rules(vec![site(true, "app.example.test", 8080)]).validate();
        assert!(name.exposures[0].visible_externally);
        assert_eq!(name.exposures[0].reason, ExposureReason::HostName);
    }

    #[test]
    fn exposure_lists_only_enabled_sites_with_bracketed_ipv6_authority() {
        let validation =
            rules(vec![site(false, "0.0.0.0", 8080), site(true, "::", 9000)]).validate();

        assert_eq!(validation.exposures.len(), 1);
        assert_eq!(validation.exposures[0].site, 1);
        assert_eq!(validation.exposures[0].listen, "[::]:9000");
    }

    #[test]
    fn upstream_scheme_accepts_only_http_and_https() {
        let http: UpstreamScheme = serde_json::from_str("\"http\"").expect("http scheme");
        let https: UpstreamScheme = serde_json::from_str("\"https\"").expect("https scheme");
        assert_eq!((http, https), (UpstreamScheme::Http, UpstreamScheme::Https));
        assert!(serde_json::from_str::<UpstreamScheme>("\"ftp\"").is_err());
        assert!(serde_json::from_str::<UpstreamScheme>("\"HTTP\"").is_err());
    }

    #[test]
    fn decoding_rejects_unknown_fields_and_out_of_range_ports() {
        let unknown = r#"{"version":1,"sites":[],"extra":true}"#;
        assert!(serde_json::from_str::<CaddyRules>(unknown).is_err());

        let unknown_listen = r#"{"enabled":true,"listen":{"host":"127.0.0.1","port":8080,"tls":true},"upstreams":[]}"#;
        assert!(serde_json::from_str::<SiteRule>(unknown_listen).is_err());

        let big_port =
            r#"{"enabled":true,"listen":{"host":"127.0.0.1","port":70000},"upstreams":[]}"#;
        assert!(serde_json::from_str::<SiteRule>(big_port).is_err());

        let path_in_upstream = r#"{"scheme":"http","host":"127.0.0.1","port":3000,"path":"/api"}"#;
        assert!(serde_json::from_str::<Upstream>(path_in_upstream).is_err());
    }

    #[test]
    fn upstream_has_no_path_field_so_path_prefixes_cannot_be_expressed() {
        let decoded: Upstream =
            serde_json::from_str(r#"{"scheme":"https","host":"example.test","port":443}"#)
                .expect("scheme, host and port decode");

        assert_eq!(decoded.scheme.as_str(), "https");
        assert_eq!(decoded.port, 443);
    }

    const CERT_ID: &str = "3f2b8c1e-6a4d-4b7e-9c2f-1a2b3c4d5e6f";
    const KEY_ID: &str = "7c9d0e1f-2a3b-4c5d-8e6f-7a8b9c0d1e2f";

    fn tls_site(host: &str) -> SiteRule {
        let mut site = site(true, host, 8443);
        site.tls = Some(TlsConfig {
            certificate_grant_id: CERT_ID.to_owned(),
            private_key_grant_id: KEY_ID.to_owned(),
        });
        site
    }

    #[test]
    fn rules_json_without_tls_or_access_log_decodes_with_defaults() {
        let legacy = r#"{"version":1,"sites":[{"enabled":true,"listen":{"host":"127.0.0.1","port":8080},"upstreams":[{"scheme":"http","host":"127.0.0.1","port":3000}]}]}"#;
        let decoded: CaddyRules = serde_json::from_str(legacy).expect("legacy rules decode");

        assert_eq!(decoded.sites[0].tls, None);
        assert!(!decoded.sites[0].access_log);
    }

    #[test]
    fn default_http_rules_serialize_without_the_new_keys() {
        let text = serde_json::to_string(&CaddyRules::example()).expect("serialize");

        assert!(!text.contains("\"tls\""));
        assert!(!text.contains("accessLog"));
    }

    #[test]
    fn tls_and_access_log_round_trip_with_camel_case_keys() {
        let mut site = tls_site("app.example.test");
        site.access_log = true;
        let text = serde_json::to_string(&rules(vec![site.clone()])).expect("serialize");

        assert!(text.contains("\"certificateGrantId\""));
        assert!(text.contains("\"privateKeyGrantId\""));
        assert!(text.contains("\"accessLog\":true"));
        let decoded: CaddyRules = serde_json::from_str(&text).expect("decode");
        assert_eq!(decoded.sites, vec![site]);
    }

    #[test]
    fn tls_config_refuses_path_key_material_and_missing_fields() {
        let with_path = format!(
            r#"{{"certificateGrantId":"{CERT_ID}","privateKeyGrantId":"{KEY_ID}","certificatePath":"/tmp/a.pem"}}"#
        );
        assert!(serde_json::from_str::<TlsConfig>(&with_path).is_err());

        let with_key_material = format!(
            r#"{{"certificateGrantId":"{CERT_ID}","privateKeyGrantId":"{KEY_ID}","privateKey":"-----BEGIN"}}"#
        );
        assert!(serde_json::from_str::<TlsConfig>(&with_key_material).is_err());

        let missing_key = format!(r#"{{"certificateGrantId":"{CERT_ID}"}}"#);
        assert!(serde_json::from_str::<TlsConfig>(&missing_key).is_err());
    }

    #[test]
    fn access_log_refuses_non_boolean_values_and_unknown_site_keys() {
        let non_boolean = r#"{"enabled":true,"listen":{"host":"127.0.0.1","port":8080},"upstreams":[],"accessLog":"yes"}"#;
        assert!(serde_json::from_str::<SiteRule>(non_boolean).is_err());

        let unknown = r#"{"enabled":true,"listen":{"host":"127.0.0.1","port":8080},"upstreams":[],"logPath":"/tmp/x"}"#;
        assert!(serde_json::from_str::<SiteRule>(unknown).is_err());
    }

    #[test]
    fn tls_site_with_domain_or_localhost_and_valid_grants_is_accepted() {
        for host in ["app.example.test", "localhost"] {
            let validation = rules(vec![tls_site(host)]).validate();

            assert!(
                validation.issues.is_empty(),
                "host {host} should be accepted, got {:?}",
                validation.issues
            );
            assert!(!validation.is_blocking());
        }
    }

    #[test]
    fn tls_on_an_ip_host_only_warns_because_the_certificate_is_not_inspected() {
        let validation = rules(vec![tls_site("127.0.0.1")]).validate();

        assert_eq!(codes(&validation), vec![IssueCode::TlsIpAddress]);
        assert_eq!(validation.issues[0].severity, Severity::Warning);
        assert!(!validation.is_blocking());
    }

    #[test]
    fn malformed_or_reused_tls_grant_ids_are_refused() {
        let mut malformed = tls_site("localhost");
        malformed.tls = Some(TlsConfig {
            certificate_grant_id: "/Users/someone/cert.pem".to_owned(),
            private_key_grant_id: KEY_ID.to_owned(),
        });
        let validation = rules(vec![malformed]).validate();
        assert_eq!(codes(&validation), vec![IssueCode::InvalidTlsGrant]);
        assert_eq!(validation.issues[0].field, Some("tls.certificateGrantId"));
        assert!(validation.is_blocking());

        let mut reused = tls_site("localhost");
        reused.tls = Some(TlsConfig {
            certificate_grant_id: CERT_ID.to_owned(),
            private_key_grant_id: CERT_ID.to_owned(),
        });
        let validation = rules(vec![reused]).validate();
        assert_eq!(codes(&validation), vec![IssueCode::InvalidTlsGrant]);
        assert_eq!(validation.issues[0].field, Some("tls.privateKeyGrantId"));
        assert!(validation.is_blocking());
    }
}
