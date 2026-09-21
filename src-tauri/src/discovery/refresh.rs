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
use crate::settings::ProviderTimeoutPreset;

use super::{
    candidates::{ConfigurationCoverage, discover_candidates},
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

struct CoordinatorState {
    refreshing: bool,
    generation: u64,
    snapshot: DiscoverySnapshot,
    brew_inventory: Option<BrewInventory>,
}

type SystemRunner = Arc<dyn Fn() -> Result<SystemSummary, DiscoveryIssue> + Send + Sync>;
type BrewRunner = Arc<dyn Fn() -> Result<BrewInventory, InventoryError> + Send + Sync>;
type CandidateRunner = Arc<dyn Fn() -> Result<ConfigurationCoverage, DiscoveryIssue> + Send + Sync>;

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
}

impl Default for DiscoveryCoordinator {
    fn default() -> Self {
        Self::new(
            DiscoveryRunners {
                system: Arc::new(discover_system),
                brew: Arc::new(discover_inventory),
                candidates: Arc::new(discover_candidates),
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
                }),
                changed: Condvar::new(),
            }),
            runners,
            timeouts: Arc::new(RwLock::new(timeouts)),
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

    pub fn snapshot_after_local(&self) -> DiscoverySnapshot {
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
        let state = self
            .inner
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        let should_start = !state.refreshing && state.generation == 0;
        drop(state);
        if should_start {
            let coordinator = self.clone();
            thread::spawn(move || {
                coordinator.refresh();
            });
        }
    }

    pub fn refresh(&self) -> DiscoverySnapshot {
        let timeouts = self.timeouts();
        let generation = {
            let mut state = self
                .inner
                .state
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            if state.refreshing {
                let active_generation = state.generation;
                state = self
                    .inner
                    .changed
                    .wait_while(state, |state| {
                        state.refreshing && state.generation == active_generation
                    })
                    .unwrap_or_else(|error| error.into_inner());
                return state.snapshot.clone();
            }

            state.refreshing = true;
            state.generation = state.generation.saturating_add(1);
            state.snapshot = DiscoverySnapshot {
                refresh_id: Uuid::new_v4().to_string(),
                started_at_epoch_ms: now_epoch_ms(),
                completed_at_epoch_ms: None,
                system: ModuleSnapshot::loading(),
                brew: ModuleSnapshot::loading(),
                candidates: ModuleSnapshot::loading(),
            };
            state.brew_inventory = None;
            state.generation
        };

        let started_at = Instant::now();
        let system = spawn_module(self.runners.system.clone());
        let candidates = spawn_module(self.runners.candidates.clone());
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

fn spawn_module<T: Send + 'static>(runner: Arc<dyn Fn() -> T + Send + Sync>) -> Receiver<T> {
    let (sender, receiver) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let _ = sender.send(runner());
    });
    receiver
}

fn receive_before<T>(
    receiver: Receiver<T>,
    started_at: Instant,
    timeout: Duration,
) -> Result<T, ()> {
    let remaining = timeout.saturating_sub(started_at.elapsed());
    receiver.recv_timeout(remaining).map_err(|_| ())
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
    use std::sync::atomic::{AtomicUsize, Ordering};

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

    #[test]
    fn duplicate_refresh_requests_join_the_active_scan() {
        let system_runs = Arc::new(AtomicUsize::new(0));
        let counter = system_runs.clone();
        let coordinator = DiscoveryCoordinator::new(
            DiscoveryRunners {
                system: Arc::new(move || {
                    counter.fetch_add(1, Ordering::SeqCst);
                    thread::sleep(Duration::from_millis(60));
                    Ok(sample_system())
                }),
                brew: Arc::new(|| Err(InventoryError::NotFound)),
                candidates: Arc::new(|| Ok(ConfigurationCoverage::empty())),
            },
            ModuleTimeouts {
                system: Duration::from_secs(1),
                brew: Duration::from_secs(1),
                candidates: Duration::from_secs(1),
            },
        );
        let first = coordinator.clone();
        let second = coordinator.clone();
        let first_thread = thread::spawn(move || first.refresh());
        thread::sleep(Duration::from_millis(10));
        let second_thread = thread::spawn(move || second.refresh());

        let first_snapshot = first_thread.join().expect("first refresh should finish");
        let second_snapshot = second_thread.join().expect("second refresh should finish");

        assert_eq!(system_runs.load(Ordering::SeqCst), 1);
        assert_eq!(first_snapshot.refresh_id, second_snapshot.refresh_id);
    }

    #[test]
    fn module_timeout_preserves_completed_partial_results() {
        let coordinator = DiscoveryCoordinator::new(
            DiscoveryRunners {
                system: Arc::new(|| Ok(sample_system())),
                brew: Arc::new(|| {
                    thread::sleep(Duration::from_millis(100));
                    Err(InventoryError::NotFound)
                }),
                candidates: Arc::new(|| Ok(ConfigurationCoverage::empty())),
            },
            ModuleTimeouts {
                system: Duration::from_millis(50),
                brew: Duration::from_millis(20),
                candidates: Duration::from_millis(50),
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
    }
}
