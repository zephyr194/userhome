//! Reports for applying a changed configuration to the own serving instance.
//!
//! A reload is reported as succeeded only after the command succeeds and a review
//! confirms the instance still answers on its private admin socket. Every failure
//! states what was confirmed and what stays unknown; nothing is rolled back.

use std::{ffi::OsString, path::Path, time::Duration};

use serde::Serialize;

use crate::caddy::validate::{ADAPTER, CaddyDiagnostic};

pub const RELOAD_TIMEOUT: Duration = Duration::from_secs(15);

const SUCCESS_TEXT: &str = "已重载并复核通过：进程存活、管理端点可连接，活动配置已记录为新版本。";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ApplyOutcome {
    Succeeded,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ApplyFailure {
    ValidationFailed,
    PreparationFailed,
    CommandFailed,
    Timeout,
    ReviewFailed,
}

/// Which configuration the instance is known to serve after the attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ServingConfig {
    Previous,
    Candidate,
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceReview {
    pub alive: bool,
    pub admin_reachable: bool,
    pub config: ServingConfig,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyReport {
    pub session_id: String,
    pub outcome: ApplyOutcome,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub failure: Option<ApplyFailure>,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub review: Option<InstanceReview>,
    pub diagnostics: Vec<CaddyDiagnostic>,
}

impl ApplyReport {
    pub fn succeeded(session_id: String, review: InstanceReview) -> Self {
        Self {
            session_id,
            outcome: ApplyOutcome::Succeeded,
            failure: None,
            message: SUCCESS_TEXT.to_owned(),
            review: Some(review),
            diagnostics: Vec::new(),
        }
    }

    pub fn failed(
        session_id: String,
        failure: ApplyFailure,
        review: Option<InstanceReview>,
        diagnostics: Vec<CaddyDiagnostic>,
    ) -> Self {
        let message = match review {
            Some(review) => format!("{} {}", failure_text(failure), review_text(review)),
            None => failure_text(failure).to_owned(),
        };
        Self {
            session_id,
            outcome: ApplyOutcome::Failed,
            failure: Some(failure),
            message,
            review,
            diagnostics,
        }
    }
}

/// The argument list is fixed; only the config copy and the socket vary. The
/// socket is the one this run was started with, so no other endpoint is named.
pub fn reload_arguments(config: &Path, socket: &Path) -> Vec<OsString> {
    vec![
        "reload".into(),
        "--config".into(),
        config.as_os_str().to_owned(),
        "--adapter".into(),
        ADAPTER.into(),
        "--address".into(),
        format!("unix/{}", socket.display()).into(),
    ]
}

fn failure_text(failure: ApplyFailure) -> &'static str {
    match failure {
        ApplyFailure::ValidationFailed => {
            "配置未通过校验（含外部引用检查），未重载；运行中的实例未改动。"
        }
        ApplyFailure::PreparationFailed => "无法准备重载配置副本，未执行重载；运行中的实例未改动。",
        ApplyFailure::CommandFailed => "重载命令失败。",
        ApplyFailure::Timeout => "重载命令超时。",
        ApplyFailure::ReviewFailed => {
            "重载命令已返回成功，但复核未通过，不能确认实例状态，不宣称成功。"
        }
    }
}

fn review_text(review: InstanceReview) -> &'static str {
    match (review.alive, review.admin_reachable, review.config) {
        (false, _, _) => "实例进程已不在运行，状态未知；未自动重启或重试。",
        (true, true, ServingConfig::Previous) => {
            "进程存活且管理端点可连接，旧配置仍是记录中的活动配置；未能直接核验运行中的内容。"
        }
        (true, true, _) => "进程存活且管理端点可连接，但配置状态无法确认。",
        (true, false, _) => "进程存活但管理端点不可连接，旧配置可能仍在运行，状态未知。",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rendered(arguments: &[OsString]) -> Vec<String> {
        arguments
            .iter()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn reload_arguments_are_fixed_and_address_only_the_given_socket() {
        let arguments = reload_arguments(
            Path::new("/tmp/run/reload.Caddyfile"),
            Path::new("/tmp/run/admin.sock"),
        );
        assert_eq!(
            rendered(&arguments),
            vec![
                "reload",
                "--config",
                "/tmp/run/reload.Caddyfile",
                "--adapter",
                "caddyfile",
                "--address",
                "unix//tmp/run/admin.sock",
            ]
        );
    }

    #[test]
    fn a_failed_command_with_a_serving_instance_names_the_previous_config() {
        let report = ApplyReport::failed(
            "session".to_owned(),
            ApplyFailure::CommandFailed,
            Some(InstanceReview {
                alive: true,
                admin_reachable: true,
                config: ServingConfig::Previous,
            }),
            Vec::new(),
        );
        assert_eq!(report.outcome, ApplyOutcome::Failed);
        assert!(report.message.contains("旧配置仍是记录中的活动配置"));
    }

    #[test]
    fn a_review_failure_is_never_a_success() {
        let report = ApplyReport::failed(
            "session".to_owned(),
            ApplyFailure::ReviewFailed,
            Some(InstanceReview {
                alive: true,
                admin_reachable: false,
                config: ServingConfig::Unknown,
            }),
            Vec::new(),
        );
        assert_ne!(report.outcome, ApplyOutcome::Succeeded);
        assert!(report.message.contains("不宣称成功"));
        assert!(report.message.contains("状态未知"));
    }

    #[test]
    fn a_dead_instance_after_a_failed_reload_is_reported_as_unknown_not_restarted() {
        let report = ApplyReport::failed(
            "session".to_owned(),
            ApplyFailure::CommandFailed,
            Some(InstanceReview {
                alive: false,
                admin_reachable: false,
                config: ServingConfig::Unknown,
            }),
            Vec::new(),
        );
        assert!(report.message.contains("未自动重启"));
    }
}
