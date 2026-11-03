use std::{
    sync::{
        Arc, Condvar, Mutex, RwLock,
        mpsc::{self, Receiver},
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::Serialize;
use uuid::Uuid;

use crate::brew::inventory::{
    BrewInventory, BrewInventorySummary, BrewPackagePage, BrewPackageQuery, InventoryError,
    discover_inventory,
};
use crate::settings::{OptionalDiscoveryRoot, ProviderTimeoutPreset};

use super::{
    candidates::{ConfigurationCoverage, discover_candidates_with_roots},
    system::{DiscoveryIssue, SystemSummary, discover_system},
};

const SYSTEM_TIMEOUT: Duration = Duration::from_secs(2);
const CANDIDATES_TIMEOUT: Duration = Duration::from_secs(2);
const BREW_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ModuleStatus {
    Loading,
    Ready,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleSnapshot<T> {
    pub(crate) status: ModuleStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) data: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error: Option<DiscoveryIssue>,
}

impl<T> ModuleSnapshot<T> {
    fn loading() -> Self {
        Self {
            status: ModuleStatus::Loading,
            data: None,
            error: None,
        }
    }

    fn ready(data: T) -> Self {
        Self {
            status: ModuleStatus::Ready,
            data: Some(data),
            error: None,
        }
    }

    fn error(error: DiscoveryIssue) -> Self {
        Self {
            status: ModuleStatus::Error,
            data: None,
            error: Some(error),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoverySnapshot {
    refresh_id: String,
    started_at_epoch_ms: u64,
    completed_at_epoch_ms: Option<u64>,
    system: ModuleSnapshot<SystemSummary>,
    brew: ModuleSnapshot<BrewInventorySummary>,
    candidates: ModuleSnapshot<ConfigurationCoverage>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DiagnosticRefreshState {
    NotStarted,
    Refreshing,
    Complete,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DiagnosticProviderState {
    Loading,
    Healthy,
    Partial,
    Unavailable,
    Error,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DiscoveryDiagnostics {
    pub(crate) macos_version: Option<String>,
    pub(crate) architecture: Option<String>,
    pub(crate) refresh_state: DiagnosticRefreshState,
    pub(crate) completed_at_epoch_ms: Option<u64>,
    pub(crate) system: DiagnosticProviderState,
    pub(crate) homebrew: DiagnosticProviderState,
    pub(crate) candidates: DiagnosticProviderState,
}

struct CoordinatorState {
    refreshing: bool,
    generation: u64,
    snapshot: DiscoverySnapshot,
    brew_inventory: Option<BrewInventory>,
    /// 测试观察点：已经加入进行中扫描、进入 wait_while 的 refresh 调用数。
    #[cfg(test)]
    joined_refreshes: usize,
}

impl CoordinatorState {
    /// 登记一轮新扫描并返回它的 generation；调用者必须持有状态锁。
    fn begin_scan(&mut self) -> u64 {
        self.refreshing = true;
        self.generation = self.generation.saturating_add(1);
        self.snapshot = DiscoverySnapshot {
            refresh_id: Uuid::new_v4().to_string(),
            started_at_epoch_ms: now_epoch_ms(),
            completed_at_epoch_ms: None,
            system: ModuleSnapshot::loading(),
            brew: ModuleSnapshot::loading(),
            candidates: ModuleSnapshot::loading(),
        };
        self.brew_inventory = None;
        self.generation
    }
}

type SystemRunner = Arc<dyn Fn() -> Result<SystemSummary, DiscoveryIssue> + Send + Sync>;
type BrewRunner = Arc<dyn Fn() -> Result<BrewInventory, InventoryError> + Send + Sync>;
type CandidateRunner = Arc<
    dyn Fn(&[OptionalDiscoveryRoot]) -> Result<ConfigurationCoverage, DiscoveryIssue> + Send + Sync,
>;

#[derive(Clone)]
struct DiscoveryRunners {
    system: SystemRunner,
    brew: BrewRunner,
    candidates: CandidateRunner,
}

#[derive(Clone, Copy)]
struct ModuleTimeouts {
    system: Duration,
    brew: Duration,
    candidates: Duration,
}

impl ModuleTimeouts {
    fn from_preset(preset: ProviderTimeoutPreset) -> Self {
        match preset {
            ProviderTimeoutPreset::Short => Self {
                system: Duration::from_secs(1),
                brew: Duration::from_secs(5),
                candidates: Duration::from_secs(1),
            },
            ProviderTimeoutPreset::Standard => Self {
                system: SYSTEM_TIMEOUT,
                brew: BREW_TIMEOUT,
                candidates: CANDIDATES_TIMEOUT,
            },
            ProviderTimeoutPreset::Extended => Self {
                system: Duration::from_secs(5),
                brew: Duration::from_secs(20),
                candidates: Duration::from_secs(5),
            },
        }
    }
}

struct CoordinatorInner {
    state: Mutex<CoordinatorState>,
    changed: Condvar,
}

#[derive(Clone)]
pub struct DiscoveryCoordinator {
    inner: Arc<CoordinatorInner>,
    runners: DiscoveryRunners,
    timeouts: Arc<RwLock<ModuleTimeouts>>,
    optional_discovery_roots: Arc<RwLock<Vec<OptionalDiscoveryRoot>>>,
}

impl Default for DiscoveryCoordinator {
    fn default() -> Self {
        Self::new(
            DiscoveryRunners {
                system: Arc::new(discover_system),
                brew: Arc::new(discover_inventory),
                candidates: Arc::new(discover_candidates_with_roots),
            },
            ModuleTimeouts::from_preset(ProviderTimeoutPreset::Standard),
        )
    }
}

impl DiscoverySnapshot {
    pub(crate) fn application_counts(&self) -> Option<(usize, usize, bool)> {
        match &self.system {
            ModuleSnapshot {
                status: ModuleStatus::Ready,
                data: Some(summary),
                ..
            } => Some((
                summary.detected_app_count(),
                summary.applications.len(),
                summary.completeness == super::system::DiscoveryCompleteness::Partial
                    || summary.has_partial_application_detection(),
            )),
            _ => None,
        }
    }
}

impl DiscoveryCoordinator {
    fn new(runners: DiscoveryRunners, timeouts: ModuleTimeouts) -> Self {
        Self {
            inner: Arc::new(CoordinatorInner {
                state: Mutex::new(CoordinatorState {
                    refreshing: false,
                    generation: 0,
                    snapshot: empty_snapshot(),
                    brew_inventory: None,
                    #[cfg(test)]
                    joined_refreshes: 0,
                }),
                changed: Condvar::new(),
            }),
            runners,
            timeouts: Arc::new(RwLock::new(timeouts)),
            optional_discovery_roots: Arc::new(RwLock::new(OptionalDiscoveryRoot::ALL.to_vec())),
        }
    }

    pub fn set_timeout_preset(&self, preset: ProviderTimeoutPreset) {
        let mut timeouts = self
            .timeouts
            .write()
            .unwrap_or_else(|error| error.into_inner());
        *timeouts = ModuleTimeouts::from_preset(preset);
    }

    fn timeouts(&self) -> ModuleTimeouts {
        *self
            .timeouts
            .read()
            .unwrap_or_else(|error| error.into_inner())
    }

    pub fn set_optional_discovery_roots(&self, roots: &[OptionalDiscoveryRoot]) {
        let mut configured_roots = self
            .optional_discovery_roots
            .write()
            .unwrap_or_else(|error| error.into_inner());
        configured_roots.clear();
        configured_roots.extend_from_slice(roots);
    }

    fn optional_discovery_roots(&self) -> Vec<OptionalDiscoveryRoot> {
        self.optional_discovery_roots
            .read()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }

    pub(crate) fn diagnostics(&self) -> DiscoveryDiagnostics {
        let state = self
            .inner
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let system_summary = match &state.snapshot.system {
            ModuleSnapshot {
                status: ModuleStatus::Ready,
                data: Some(summary),
                ..
            } => Some(summary),
            _ => None,
        };
        DiscoveryDiagnostics {
            macos_version: system_summary.and_then(|summary| summary.os_version.clone()),
            architecture: system_summary.and_then(|summary| summary.architecture.clone()),
            refresh_state: if state.refreshing {
                DiagnosticRefreshState::Refreshing
            } else if state.generation == 0 {
                DiagnosticRefreshState::NotStarted
            } else {
                DiagnosticRefreshState::Complete
            },
            completed_at_epoch_ms: state.snapshot.completed_at_epoch_ms,
            system: match &state.snapshot.system {
                ModuleSnapshot {
                    status: ModuleStatus::Ready,
                    data: Some(summary),
                    ..
                } if summary.completeness == super::system::DiscoveryCompleteness::Partial => {
                    DiagnosticProviderState::Partial
                }
                ModuleSnapshot {
                    status: ModuleStatus::Ready,
                    ..
                } => DiagnosticProviderState::Healthy,
                ModuleSnapshot {
                    status: ModuleStatus::Error,
                    ..
                } => DiagnosticProviderState::Error,
                _ => DiagnosticProviderState::Loading,
            },
            homebrew: match &state.snapshot.brew {
                ModuleSnapshot {
                    status: ModuleStatus::Ready,
                    data: Some(summary),
                    ..
                } if !summary.is_available() => DiagnosticProviderState::Unavailable,
                ModuleSnapshot {
                    status: ModuleStatus::Ready,
                    ..
                } => DiagnosticProviderState::Healthy,
                ModuleSnapshot {
                    status: ModuleStatus::Error,
                    ..
                } => DiagnosticProviderState::Error,
                _ => DiagnosticProviderState::Loading,
            },
            candidates: match &state.snapshot.candidates {
                ModuleSnapshot {
                    status: ModuleStatus::Ready,
                    data: Some(coverage),
                    ..
                } if coverage.completeness == super::system::DiscoveryCompleteness::Partial => {
                    DiagnosticProviderState::Partial
                }
                ModuleSnapshot {
                    status: ModuleStatus::Ready,
                    ..
                } => DiagnosticProviderState::Healthy,
                ModuleSnapshot {
                    status: ModuleStatus::Error,
                    ..
                } => DiagnosticProviderState::Error,
                _ => DiagnosticProviderState::Loading,
            },
        }
    }

    pub fn snapshot_after_local(&self) -> DiscoverySnapshot {
        // 首次读取可能早于前端的刷新请求，或者根本没有刷新请求（启动时不刷新）：
        // 先同步登记首轮扫描，下面的等待才会等到 system 模块，而不是拿到一份空快照。
        self.ensure_initial_refresh();
        let timeouts = self.timeouts();
        let mut state = self
            .inner
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if state.refreshing && state.snapshot.system.status == ModuleStatus::Loading {
            let (next_state, _) = self
                .inner
                .changed
                .wait_timeout_while(state, timeouts.system, |state| {
                    state.refreshing && state.snapshot.system.status == ModuleStatus::Loading
                })
                .unwrap_or_else(|error| error.into_inner());
            state = next_state;
        }

        state.snapshot.clone()
    }

    pub fn ensure_initial_refresh(&self) {
        // 在状态锁内同步登记首轮扫描（refreshing = true），再交给后台线程执行：
        // 返回之后任何读取者都能看到"正在刷新"，不会出现线程尚未启动的空窗。
        let generation = {
            let mut state = self
                .inner
                .state
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            if state.refreshing || state.generation != 0 {
                return;
            }
            state.begin_scan()
        };
        let coordinator = self.clone();
        thread::spawn(move || {
            coordinator.run_scan(generation);
        });
    }

    pub fn refresh(&self) -> DiscoverySnapshot {
        let generation = {
            let mut state = self
                .inner
                .state
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            if state.refreshing {
                let active_generation = state.generation;
                #[cfg(test)]
                self.record_joined_refresh(&mut state);
                state = self
                    .inner
                    .changed
                    .wait_while(state, |state| {
                        state.refreshing && state.generation == active_generation
                    })
                    .unwrap_or_else(|error| error.into_inner());
                return state.snapshot.clone();
            }

            state.begin_scan()
        };

        self.run_scan(generation)
    }

    /// 在仍持有状态锁时记录并通知：观察者拿到锁并看到计数，说明调用者已原子地进入等待。
    #[cfg(test)]
    fn record_joined_refresh(&self, state: &mut CoordinatorState) {
        state.joined_refreshes += 1;
        self.inner.changed.notify_all();
    }

    /// 执行已登记（`begin_scan`）的一轮扫描，直到 brew 结果落定。
    fn run_scan(&self, generation: u64) -> DiscoverySnapshot {
        let timeouts = self.timeouts();
        let started_at = Instant::now();
        let system = spawn_module(self.runners.system.clone());
        let candidate_runner = self.runners.candidates.clone();
        let optional_roots = self.optional_discovery_roots();
        let candidates = spawn_module(Arc::new(move || candidate_runner(&optional_roots)));
        let brew = spawn_module(self.runners.brew.clone());

        let system_result = receive_before(system, started_at, timeouts.system);
        self.update_system(generation, system_result);

        let candidates_result = receive_before(candidates, started_at, timeouts.candidates);
        self.update_candidates(generation, candidates_result);

        let brew_result = receive_before(brew, started_at, timeouts.brew);
        self.finish(generation, brew_result)
    }

    pub fn brew_page(&self, query: &BrewPackageQuery) -> Result<BrewPackagePage, InventoryError> {
        let timeouts = self.timeouts();
        let mut state = self
            .inner
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if state.refreshing && state.snapshot.brew.status == ModuleStatus::Loading {
            let (next_state, _) = self
                .inner
                .changed
                .wait_timeout_while(state, timeouts.brew, |state| {
                    state.refreshing && state.snapshot.brew.status == ModuleStatus::Loading
                })
                .unwrap_or_else(|error| error.into_inner());
            state = next_state;
        }
        if let Some(inventory) = &state.brew_inventory {
            return inventory.page(query);
        }
        drop(state);

        let inventory = (self.runners.brew)()?;
        let page = inventory.page(query)?;
        let mut state = self
            .inner
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        state.snapshot.brew = ModuleSnapshot::ready(inventory.summary());
        state.brew_inventory = Some(inventory);
        self.inner.changed.notify_all();
        Ok(page)
    }

    pub fn refresh_brew_inventory(&self) -> Result<(), InventoryError> {
        let inventory = (self.runners.brew)();
        let mut state = self
            .inner
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        match inventory {
            Ok(inventory) => {
                state.snapshot.brew = ModuleSnapshot::ready(inventory.summary());
                state.brew_inventory = Some(inventory);
                self.inner.changed.notify_all();
                Ok(())
            }
            Err(InventoryError::NotFound) => {
                state.snapshot.brew = ModuleSnapshot::ready(BrewInventorySummary::unavailable());
                state.brew_inventory = None;
                self.inner.changed.notify_all();
                Ok(())
            }
            Err(error) => {
                state.snapshot.brew = ModuleSnapshot::error(brew_issue(error.clone()));
                state.brew_inventory = None;
                self.inner.changed.notify_all();
                Err(error)
            }
        }
    }

    pub fn candidates(&self) -> Result<ConfigurationCoverage, DiscoveryIssue> {
        let timeouts = self.timeouts();
        self.ensure_initial_refresh();
        let mut state = self
            .inner
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if state.refreshing && state.snapshot.candidates.status == ModuleStatus::Loading {
            let (next_state, _) = self
                .inner
                .changed
                .wait_timeout_while(state, timeouts.candidates, |state| {
                    state.refreshing && state.snapshot.candidates.status == ModuleStatus::Loading
                })
                .unwrap_or_else(|error| error.into_inner());
            state = next_state;
        }
        match &state.snapshot.candidates {
            ModuleSnapshot {
                status: ModuleStatus::Ready,
                data: Some(candidates),
                ..
            } => Ok(candidates.clone()),
            ModuleSnapshot {
                status: ModuleStatus::Error,
                error: Some(error),
                ..
            } => Err(error.clone()),
            _ => Err(DiscoveryIssue::new(
                "candidates",
                "Candidate discovery timed out.",
                true,
            )),
        }
    }

    fn update_system(
        &self,
        generation: u64,
        result: Result<Result<SystemSummary, DiscoveryIssue>, ()>,
    ) {
        let mut state = self
            .inner
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if state.generation != generation {
            return;
        }
        state.snapshot.system = match result {
            Ok(Ok(summary)) => ModuleSnapshot::ready(summary),
            Ok(Err(error)) => ModuleSnapshot::error(error),
            Err(()) => ModuleSnapshot::error(DiscoveryIssue::new(
                "system",
                "Local system discovery timed out.",
                true,
            )),
        };
        self.inner.changed.notify_all();
    }

    fn update_candidates(
        &self,
        generation: u64,
        result: Result<Result<ConfigurationCoverage, DiscoveryIssue>, ()>,
    ) {
        let timeouts = self.timeouts();
        let mut state = self
            .inner
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if state.generation != generation {
            return;
        }
        state.snapshot.candidates = match result {
            Ok(Ok(candidates)) => ModuleSnapshot::ready(candidates),
            Ok(Err(error)) => ModuleSnapshot::error(error),
            Err(()) => ModuleSnapshot::ready(ConfigurationCoverage::timed_out(timeouts.candidates)),
        };
        self.inner.changed.notify_all();
    }

    fn finish(
        &self,
        generation: u64,
        result: Result<Result<BrewInventory, InventoryError>, ()>,
    ) -> DiscoverySnapshot {
        let mut state = self
            .inner
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if state.generation != generation {
            return state.snapshot.clone();
        }
        match result {
            Ok(Ok(inventory)) => {
                state.snapshot.brew = ModuleSnapshot::ready(inventory.summary());
                state.brew_inventory = Some(inventory);
            }
            Ok(Err(InventoryError::NotFound)) => {
                state.snapshot.brew = ModuleSnapshot::ready(BrewInventorySummary::unavailable());
            }
            Ok(Err(error)) => {
                state.snapshot.brew = ModuleSnapshot::error(brew_issue(error));
            }
            Err(()) => {
                state.snapshot.brew = ModuleSnapshot::error(DiscoveryIssue::new(
                    "homebrew",
                    "Homebrew inventory timed out.",
                    true,
                ));
            }
        }
        state.snapshot.completed_at_epoch_ms = Some(now_epoch_ms());
        state.refreshing = false;
        let snapshot = state.snapshot.clone();
        self.inner.changed.notify_all();
        snapshot
    }
}

fn empty_snapshot() -> DiscoverySnapshot {
    DiscoverySnapshot {
        refresh_id: String::new(),
        started_at_epoch_ms: 0,
        completed_at_epoch_ms: None,
        system: ModuleSnapshot::loading(),
        brew: ModuleSnapshot::loading(),
        candidates: ModuleSnapshot::loading(),
    }
}

/// 模块线程把结果连同"完成时刻"一起送回，截止判断以完成时刻为准，而不是协调线程检查的时刻。
fn spawn_module<T: Send + 'static>(
    runner: Arc<dyn Fn() -> T + Send + Sync>,
) -> Receiver<(T, Instant)> {
    let (sender, receiver) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let result = runner();
        let _ = sender.send((result, Instant::now()));
    });
    receiver
}

/// 严格截止：完成时刻晚于 `started_at + timeout` 的结果一律视为超时，
/// 即使它在协调线程检查之前已经到达。
fn receive_before<T>(
    receiver: Receiver<(T, Instant)>,
    started_at: Instant,
    timeout: Duration,
) -> Result<T, ()> {
    let remaining = timeout.saturating_sub(started_at.elapsed());
    let (value, finished_at) = receiver.recv_timeout(remaining).map_err(|_| ())?;
    if finished_at > started_at + timeout {
        return Err(());
    }
    Ok(value)
}

fn brew_issue(error: InventoryError) -> DiscoveryIssue {
    match error {
        InventoryError::Timeout => {
            DiscoveryIssue::new("homebrew", "Homebrew inventory timed out.", true)
        }
        InventoryError::OutputTooLarge => DiscoveryIssue::new(
            "homebrew",
            "Homebrew returned more inventory data than allowed.",
            false,
        ),
        InventoryError::MalformedJson => DiscoveryIssue::new(
            "homebrew",
            "Homebrew returned malformed inventory data.",
            true,
        ),
        InventoryError::ProcessFailed => {
            DiscoveryIssue::new("homebrew", "Homebrew inventory failed.", true)
        }
        InventoryError::NotFound => {
            DiscoveryIssue::new("homebrew", "Homebrew is not installed.", false)
        }
        InventoryError::InvalidQuery => {
            DiscoveryIssue::new("homebrew", "Homebrew query is invalid.", false)
        }
    }
}

fn now_epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Mutex,
        atomic::{AtomicUsize, Ordering},
    };

    use crate::discovery::system::DiscoveryCompleteness;

    use super::*;

    fn sample_system() -> SystemSummary {
        SystemSummary {
            completeness: DiscoveryCompleteness::Complete,
            os_version: Some("15.0".to_owned()),
            architecture: Some("arm64".to_owned()),
            home_directory: "/tmp/home".to_owned(),
            shell: Some("/bin/zsh".to_owned()),
            applications: Vec::new(),
            issues: Vec::new(),
        }
    }

    /// 仅作为"永不返回"的兜底上限：同步靠 channel / Condvar，不靠这个时长。
    const TEST_WAIT_LIMIT: Duration = Duration::from_secs(30);

    fn generous_timeouts() -> ModuleTimeouts {
        ModuleTimeouts {
            system: TEST_WAIT_LIMIT,
            brew: TEST_WAIT_LIMIT,
            candidates: TEST_WAIT_LIMIT,
        }
    }

    fn wait_until_idle(coordinator: &DiscoveryCoordinator) {
        let state = coordinator
            .inner
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let (_state, result) = coordinator
            .inner
            .changed
            .wait_timeout_while(state, TEST_WAIT_LIMIT, |state| state.refreshing)
            .unwrap_or_else(|error| error.into_inner());
        assert!(!result.timed_out(), "scan should finish once released");
    }

    fn wait_for_joined_refreshes(coordinator: &DiscoveryCoordinator, expected: usize) {
        let state = coordinator
            .inner
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let (_state, result) = coordinator
            .inner
            .changed
            .wait_timeout_while(state, TEST_WAIT_LIMIT, |state| {
                state.joined_refreshes < expected
            })
            .unwrap_or_else(|error| error.into_inner());
        assert!(
            !result.timed_out(),
            "a second refresh should join the active scan"
        );
    }

    #[test]
    fn first_read_starts_the_initial_scan_and_returns_at_system_ready() {
        // 启动时不刷新：没有任何 refresh() 调用，首次读取也不能停在空快照；
        // brew 被屏障挡住，读取必须在 system 完成后就返回，不等 brew。
        let (release_brew, brew_gate) = mpsc::channel::<()>();
        let brew_gate = Mutex::new(brew_gate);
        let system_runs = Arc::new(AtomicUsize::new(0));
        let counter = system_runs.clone();
        let coordinator = DiscoveryCoordinator::new(
            DiscoveryRunners {
                system: Arc::new(move || {
                    counter.fetch_add(1, Ordering::SeqCst);
                    Ok(sample_system())
                }),
                brew: Arc::new(move || {
                    let _ = brew_gate
                        .lock()
                        .unwrap_or_else(|error| error.into_inner())
                        .recv();
                    Err(InventoryError::NotFound)
                }),
                candidates: Arc::new(|_| Ok(ConfigurationCoverage::empty())),
            },
            generous_timeouts(),
        );

        let snapshot = coordinator.snapshot_after_local();

        assert!(!snapshot.refresh_id.is_empty());
        assert_eq!(snapshot.system.status, ModuleStatus::Ready);
        assert_eq!(snapshot.brew.status, ModuleStatus::Loading);
        assert_eq!(snapshot.completed_at_epoch_ms, None);

        release_brew
            .send(())
            .expect("brew runner should be waiting");
        wait_until_idle(&coordinator);
        let settled = coordinator.snapshot_after_local();
        assert_eq!(settled.refresh_id, snapshot.refresh_id);
        assert_eq!(settled.brew.status, ModuleStatus::Ready);
        assert_eq!(system_runs.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn ensure_initial_refresh_marks_the_scan_active_before_returning() {
        // 过去先 spawn 线程、由线程内的 refresh() 置位 refreshing，
        // 调用返回到线程拿到锁之间的读取者会看到"未开始"。
        let (release_system, system_gate) = mpsc::channel::<()>();
        let system_gate = Mutex::new(system_gate);
        let coordinator = DiscoveryCoordinator::new(
            DiscoveryRunners {
                system: Arc::new(move || {
                    let _ = system_gate
                        .lock()
                        .unwrap_or_else(|error| error.into_inner())
                        .recv();
                    Ok(sample_system())
                }),
                brew: Arc::new(|| Err(InventoryError::NotFound)),
                candidates: Arc::new(|_| Ok(ConfigurationCoverage::empty())),
            },
            generous_timeouts(),
        );

        coordinator.ensure_initial_refresh();

        assert_eq!(
            coordinator.diagnostics().refresh_state,
            DiagnosticRefreshState::Refreshing
        );

        release_system
            .send(())
            .expect("system runner should be waiting");
        wait_until_idle(&coordinator);
        assert_eq!(
            coordinator.diagnostics().refresh_state,
            DiagnosticRefreshState::Complete
        );
    }

    #[test]
    fn duplicate_refresh_requests_join_the_active_scan() {
        // system 阻塞在测试持有的 channel 上；确认第二个 refresh 已经在等待后才放行，
        // 因此"加入而不是另起一轮"不依赖线程调度快慢。
        let (system_started, started_signal) = mpsc::channel::<()>();
        let system_started = Mutex::new(system_started);
        let (release_system, system_gate) = mpsc::channel::<()>();
        let system_gate = Mutex::new(system_gate);
        let system_runs = Arc::new(AtomicUsize::new(0));
        let counter = system_runs.clone();
        let coordinator = DiscoveryCoordinator::new(
            DiscoveryRunners {
                system: Arc::new(move || {
                    counter.fetch_add(1, Ordering::SeqCst);
                    let _ = system_started
                        .lock()
                        .unwrap_or_else(|error| error.into_inner())
                        .send(());
                    let _ = system_gate
                        .lock()
                        .unwrap_or_else(|error| error.into_inner())
                        .recv();
                    Ok(sample_system())
                }),
                brew: Arc::new(|| Err(InventoryError::NotFound)),
                candidates: Arc::new(|_| Ok(ConfigurationCoverage::empty())),
            },
            generous_timeouts(),
        );
        let first = coordinator.clone();
        let second = coordinator.clone();
        let first_thread = thread::spawn(move || first.refresh());
        started_signal
            .recv_timeout(TEST_WAIT_LIMIT)
            .expect("the first refresh should start the system scan");
        let second_thread = thread::spawn(move || second.refresh());
        wait_for_joined_refreshes(&coordinator, 1);
        release_system
            .send(())
            .expect("system runner should be waiting");

        let first_snapshot = first_thread.join().expect("first refresh should finish");
        let second_snapshot = second_thread.join().expect("second refresh should finish");

        assert_eq!(system_runs.load(Ordering::SeqCst), 1);
        assert_eq!(first_snapshot.refresh_id, second_snapshot.refresh_id);
    }

    #[test]
    fn refresh_racing_the_first_read_shares_one_scan() {
        // 启动时前端同时发 get 与 refresh：get 先到并登记首轮扫描，refresh 必须加入同一轮。
        let (system_started, started_signal) = mpsc::channel::<()>();
        let system_started = Mutex::new(system_started);
        let (release_system, system_gate) = mpsc::channel::<()>();
        let system_gate = Mutex::new(system_gate);
        let system_runs = Arc::new(AtomicUsize::new(0));
        let counter = system_runs.clone();
        let coordinator = DiscoveryCoordinator::new(
            DiscoveryRunners {
                system: Arc::new(move || {
                    counter.fetch_add(1, Ordering::SeqCst);
                    let _ = system_started
                        .lock()
                        .unwrap_or_else(|error| error.into_inner())
                        .send(());
                    let _ = system_gate
                        .lock()
                        .unwrap_or_else(|error| error.into_inner())
                        .recv();
                    Ok(sample_system())
                }),
                brew: Arc::new(|| Err(InventoryError::NotFound)),
                candidates: Arc::new(|_| Ok(ConfigurationCoverage::empty())),
            },
            generous_timeouts(),
        );

        let reader = coordinator.clone();
        let read_thread = thread::spawn(move || reader.snapshot_after_local());
        started_signal
            .recv_timeout(TEST_WAIT_LIMIT)
            .expect("the first read should start the scan");
        let refresher = coordinator.clone();
        let refresh_thread = thread::spawn(move || refresher.refresh());
        wait_for_joined_refreshes(&coordinator, 1);
        release_system
            .send(())
            .expect("system runner should be waiting");

        let read_snapshot = read_thread.join().expect("first read should finish");
        let refresh_snapshot = refresh_thread.join().expect("refresh should finish");

        assert_eq!(read_snapshot.system.status, ModuleStatus::Ready);
        assert_eq!(system_runs.load(Ordering::SeqCst), 1);
        assert_eq!(read_snapshot.refresh_id, refresh_snapshot.refresh_id);
    }

    #[test]
    fn receive_before_rejects_results_finished_after_the_deadline() {
        // 完成时刻由测试注入，结果在检查之前就已在 channel 里：
        // 只有完成时刻晚于截止的才算超时，与检查快慢无关。
        let started_at = Instant::now();
        let timeout = Duration::from_millis(500);

        let (late_sender, late) = mpsc::sync_channel(1);
        late_sender
            .send(("late", started_at + timeout + Duration::from_millis(1)))
            .expect("channel has room");
        assert_eq!(receive_before(late, started_at, timeout), Err(()));

        let (on_time_sender, on_time) = mpsc::sync_channel(1);
        on_time_sender
            .send(("on-time", started_at + timeout))
            .expect("channel has room");
        assert_eq!(receive_before(on_time, started_at, timeout), Ok("on-time"));
    }

    #[test]
    fn module_timeout_preserves_completed_partial_results() {
        // brew 在测试放行前一直阻塞，超时是否触发与调度快慢无关；
        // system/candidates 立即返回，其超时只是上限，留足余量避免线程饥饿误判。
        let (release_brew, brew_gate) = mpsc::channel::<()>();
        let brew_gate = Mutex::new(brew_gate);
        let coordinator = DiscoveryCoordinator::new(
            DiscoveryRunners {
                system: Arc::new(|| Ok(sample_system())),
                brew: Arc::new(move || {
                    // 放行或发送端被丢弃（断言失败展开）都会让线程退出。
                    let _ = brew_gate
                        .lock()
                        .unwrap_or_else(|error| error.into_inner())
                        .recv();
                    Err(InventoryError::NotFound)
                }),
                candidates: Arc::new(|_| Ok(ConfigurationCoverage::empty())),
            },
            ModuleTimeouts {
                system: Duration::from_secs(5),
                brew: Duration::from_millis(20),
                candidates: Duration::from_secs(5),
            },
        );

        let snapshot = coordinator.refresh();

        assert_eq!(snapshot.system.status, ModuleStatus::Ready);
        assert_eq!(snapshot.candidates.status, ModuleStatus::Ready);
        assert_eq!(snapshot.brew.status, ModuleStatus::Error);
        assert_eq!(
            snapshot
                .brew
                .error
                .as_ref()
                .expect("brew error should be present")
                .module,
            "homebrew"
        );

        let _ = release_brew.send(());
    }

    #[test]
    fn configured_optional_roots_reach_candidate_discovery() {
        let observed_roots = Arc::new(Mutex::new(Vec::new()));
        let candidate_roots = observed_roots.clone();
        let coordinator = DiscoveryCoordinator::new(
            DiscoveryRunners {
                system: Arc::new(|| Ok(sample_system())),
                brew: Arc::new(|| Err(InventoryError::NotFound)),
                candidates: Arc::new(move |roots| {
                    *candidate_roots
                        .lock()
                        .unwrap_or_else(|error| error.into_inner()) = roots.to_vec();
                    Ok(ConfigurationCoverage::empty())
                }),
            },
            ModuleTimeouts {
                system: Duration::from_secs(1),
                brew: Duration::from_secs(1),
                candidates: Duration::from_secs(1),
            },
        );
        coordinator.set_optional_discovery_roots(&[
            OptionalDiscoveryRoot::XdgConfigHome,
            OptionalDiscoveryRoot::HomebrewPrefix,
        ]);

        coordinator.refresh();

        assert_eq!(
            *observed_roots
                .lock()
                .unwrap_or_else(|error| error.into_inner()),
            [
                OptionalDiscoveryRoot::XdgConfigHome,
                OptionalDiscoveryRoot::HomebrewPrefix,
            ]
        );
    }
}
