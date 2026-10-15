//! Application exit lifecycle.
//!
//! Closing the main window only hides it; quitting is a separate, explicit act
//! and every quit path (tray, application menu, "quit on close", a system quit)
//! goes through [`request_quit`]. UserHome must not exit and leave an own process
//! behind without saying so, so the exit is gated on the
//! [`OwnedResourceRegistry`] of own processes still running:
//!
//! - none running: the request is let through and the app exits as before;
//! - some running: nothing is stopped and the app does not exit. The frontend is
//!   asked ("stop and quit" / "cancel quit"); only [`LifecycleCoordinator::confirm_quit`]
//!   stops them, and the app exits only once *every* registered process is
//!   confirmed gone. If any exit cannot be confirmed the app stays up and says
//!   which ones;
//! - "cancel quit" changes nothing but the pending prompt.
//!
//! Stopping never happens while a lock is held: the registry is snapshotted
//! first and the processes are stopped concurrently outside every lock.

use std::{
    sync::{Arc, Mutex, MutexGuard, PoisonError},
    thread,
    time::Duration,
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::{
    error::AppError,
    process_session::{ProcessSession, SessionState, StopOutcome},
};

pub const QUIT_CONFIRMATION_EVENT: &str = "userhome://quit-confirmation-requested";

/// SIGTERM grace and the extra wait after SIGKILL, per process.
pub const QUIT_STOP_GRACE: Duration = Duration::from_secs(5);
pub const QUIT_STOP_KILL_TIMEOUT: Duration = Duration::from_secs(2);

const MAX_LABEL_CHARS: usize = 80;
/// Processes registered while a stop is under way are stopped in a further pass;
/// a registry that keeps refilling is reported instead of looped on forever.
const MAX_STOP_PASSES: usize = 3;

/// An own process the registry can ask to stop.
pub trait OwnedProcess: Send + Sync {
    /// `false` only once the exit has been confirmed. Anything unclear (stopping,
    /// unknown) counts as still running.
    fn is_running(&self) -> bool;

    /// Must report `Terminated` or `AlreadyExited` only with a confirmed exit.
    fn stop(&self, grace: Duration, kill_timeout: Duration) -> StopOutcome;
}

impl OwnedProcess for ProcessSession {
    fn is_running(&self) -> bool {
        self.status().state != SessionState::Exited
    }

    fn stop(&self, grace: Duration, kill_timeout: Duration) -> StopOutcome {
        ProcessSession::stop(self, grace, kill_timeout)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OwnedResourceId(u64);

#[derive(Clone)]
struct Entry {
    id: OwnedResourceId,
    label: String,
    process: Arc<dyn OwnedProcess>,
}

#[derive(Default)]
struct RegistryInner {
    next_id: u64,
    entries: Vec<Entry>,
}

/// Registry of the own processes whose handles the app holds. An entry leaves it
/// when its owner deregisters it or when its exit is confirmed; an entry whose
/// exit is *not* confirmed stays, so it is never silently forgotten.
#[derive(Default)]
pub struct OwnedResourceRegistry {
    inner: Mutex<RegistryInner>,
}

impl OwnedResourceRegistry {
    /// Registers a running own process under a short, human-readable label.
    pub fn register(
        &self,
        label: &str,
        process: Arc<dyn OwnedProcess>,
    ) -> Result<OwnedResourceId, AppError> {
        let label: String = label
            .chars()
            .filter(|character| !character.is_control())
            .take(MAX_LABEL_CHARS)
            .collect();
        let mut inner = self.inner.lock().map_err(|_| AppError::internal())?;
        inner.next_id += 1;
        let id = OwnedResourceId(inner.next_id);
        inner.entries.push(Entry { id, label, process });
        Ok(id)
    }

    /// Removes an entry; `false` if it was not (or no longer) registered.
    pub fn deregister(&self, id: OwnedResourceId) -> bool {
        let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        let before = inner.entries.len();
        inner.entries.retain(|entry| entry.id != id);
        inner.entries.len() != before
    }

    /// The entries still running. Entries whose exit is confirmed are pruned, so
    /// no stale entry is kept. Liveness is checked outside the registry lock.
    fn running(&self) -> Vec<Entry> {
        let snapshot = self
            .inner
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .entries
            .clone();
        let (running, exited): (Vec<Entry>, Vec<Entry>) = snapshot
            .into_iter()
            .partition(|entry| entry.process.is_running());
        if !exited.is_empty() {
            self.inner
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .entries
                .retain(|entry| !exited.iter().any(|gone| gone.id == entry.id));
        }
        running
    }

    pub fn running_count(&self) -> usize {
        self.running().len()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum QuitPhase {
    Idle,
    AwaitingConfirmation,
    Stopping,
}

/// What a quit request leads to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QuitDecision {
    /// No own process is running: exit now.
    Proceed,
    /// Own processes are running: ask first, do not exit.
    Confirm { process_count: usize },
    /// A confirmed stop is already under way; nothing more to do.
    StopInProgress,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum QuitOutcome {
    /// Every registered process is confirmed gone: the app may exit.
    ReadyToExit { stopped: usize },
    /// Exit of these processes could not be confirmed: the app must not exit.
    StopFailed {
        stopped: usize,
        unconfirmed: Vec<String>,
    },
}

/// Result of "stop and quit" as reported to the frontend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(
    tag = "status",
    rename_all = "SCREAMING_SNAKE_CASE",
    rename_all_fields = "camelCase"
)]
pub enum QuitResult {
    Quitting {
        stopped: usize,
    },
    StopFailed {
        stopped: usize,
        unconfirmed: Vec<String>,
    },
}

pub struct LifecycleCoordinator {
    registry: OwnedResourceRegistry,
    phase: Mutex<QuitPhase>,
    stop_grace: Duration,
    stop_kill_timeout: Duration,
}

impl Default for LifecycleCoordinator {
    fn default() -> Self {
        Self {
            registry: OwnedResourceRegistry::default(),
            phase: Mutex::new(QuitPhase::Idle),
            stop_grace: QUIT_STOP_GRACE,
            stop_kill_timeout: QUIT_STOP_KILL_TIMEOUT,
        }
    }
}

impl LifecycleCoordinator {
    /// Overrides how long stopping one own process waits for its exit.
    pub fn with_stop_timeouts(mut self, grace: Duration, kill_timeout: Duration) -> Self {
        self.stop_grace = grace;
        self.stop_kill_timeout = kill_timeout;
        self
    }

    pub fn registry(&self) -> &OwnedResourceRegistry {
        &self.registry
    }

    fn phase(&self) -> MutexGuard<'_, QuitPhase> {
        self.phase.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Entry of every quit path. Stops nothing by itself.
    pub fn request_quit(&self) -> QuitDecision {
        let mut phase = self.phase();
        if *phase == QuitPhase::Stopping {
            return QuitDecision::StopInProgress;
        }
        let process_count = self.registry.running_count();
        if process_count == 0 {
            *phase = QuitPhase::Idle;
            return QuitDecision::Proceed;
        }
        *phase = QuitPhase::AwaitingConfirmation;
        QuitDecision::Confirm { process_count }
    }

    /// "Cancel quit": only drops the pending prompt; no process or registry
    /// entry is touched. A stop that is already running cannot be cancelled.
    pub fn cancel_quit(&self) -> Result<(), AppError> {
        let mut phase = self.phase();
        if *phase == QuitPhase::Stopping {
            return Err(AppError::conflict("A stop is already in progress."));
        }
        *phase = QuitPhase::Idle;
        Ok(())
    }

    /// "Stop and quit": valid only after a request asked for confirmation. Blocks
    /// until every registered process is confirmed gone or one cannot be
    /// confirmed; no lock is held meanwhile. After a failure the confirmation
    /// stays pending so the user can retry or cancel.
    pub fn confirm_quit(&self) -> Result<QuitOutcome, AppError> {
        {
            let mut phase = self.phase();
            match *phase {
                QuitPhase::AwaitingConfirmation => *phase = QuitPhase::Stopping,
                QuitPhase::Stopping => {
                    return Err(AppError::conflict("A stop is already in progress."));
                }
                QuitPhase::Idle => {
                    return Err(AppError::conflict("No quit confirmation is pending."));
                }
            }
        }
        let outcome = self.stop_all();
        *self.phase() = match outcome {
            QuitOutcome::ReadyToExit { .. } => QuitPhase::Idle,
            QuitOutcome::StopFailed { .. } => QuitPhase::AwaitingConfirmation,
        };
        Ok(outcome)
    }

    fn stop_all(&self) -> QuitOutcome {
        let mut stopped = 0;
        for _ in 0..MAX_STOP_PASSES {
            let running = self.registry.running();
            if running.is_empty() {
                return QuitOutcome::ReadyToExit { stopped };
            }
            let mut unconfirmed = Vec::new();
            for (entry, outcome) in self.stop_concurrently(running) {
                match outcome {
                    StopOutcome::Terminated { .. } | StopOutcome::AlreadyExited(_) => {
                        self.registry.deregister(entry.id);
                        stopped += 1;
                    }
                    StopOutcome::Unconfirmed => unconfirmed.push(entry.label),
                }
            }
            if !unconfirmed.is_empty() {
                return QuitOutcome::StopFailed {
                    stopped,
                    unconfirmed,
                };
            }
        }
        let remaining: Vec<String> = self
            .registry
            .running()
            .into_iter()
            .map(|entry| entry.label)
            .collect();
        if remaining.is_empty() {
            QuitOutcome::ReadyToExit { stopped }
        } else {
            QuitOutcome::StopFailed {
                stopped,
                unconfirmed: remaining,
            }
        }
    }

    /// Stops all given processes at once so the wait is bounded by the slowest
    /// one, not the sum. A stop that panics counts as unconfirmed.
    fn stop_concurrently(&self, entries: Vec<Entry>) -> Vec<(Entry, StopOutcome)> {
        thread::scope(|scope| {
            let handles: Vec<_> = entries
                .iter()
                .map(|entry| {
                    let process = Arc::clone(&entry.process);
                    let (grace, kill_timeout) = (self.stop_grace, self.stop_kill_timeout);
                    scope.spawn(move || process.stop(grace, kill_timeout))
                })
                .collect();
            handles
                .into_iter()
                .zip(entries.iter().cloned())
                .map(|(handle, entry)| (entry, handle.join().unwrap_or(StopOutcome::Unconfirmed)))
                .collect()
        })
    }
}

/// What the quit flow needs from the running app.
pub trait QuitHost {
    fn exit_app(&self);
    fn show_confirmation(&self, process_count: usize);
}

/// The single quit entry, independent of the Tauri runtime.
pub fn request_quit_with(host: &impl QuitHost, coordinator: &LifecycleCoordinator) {
    match coordinator.request_quit() {
        QuitDecision::Proceed => host.exit_app(),
        QuitDecision::Confirm { process_count } => host.show_confirmation(process_count),
        QuitDecision::StopInProgress => {}
    }
}

/// "Stop and quit": exits the app only when every process is confirmed gone.
pub fn confirm_quit_with(
    host: &impl QuitHost,
    coordinator: &LifecycleCoordinator,
) -> Result<QuitResult, AppError> {
    Ok(match coordinator.confirm_quit()? {
        QuitOutcome::ReadyToExit { stopped } => {
            host.exit_app();
            QuitResult::Quitting { stopped }
        }
        QuitOutcome::StopFailed {
            stopped,
            unconfirmed,
        } => QuitResult::StopFailed {
            stopped,
            unconfirmed,
        },
    })
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct QuitConfirmationPayload {
    process_count: usize,
}

impl QuitHost for AppHandle {
    fn exit_app(&self) {
        self.exit(0);
    }

    fn show_confirmation(&self, process_count: usize) {
        // A tray quit may arrive while the window is hidden; the question must be
        // visible to be answerable.
        crate::tray::show_main_window(self);
        if let Err(error) = self.emit(
            QUIT_CONFIRMATION_EVENT,
            QuitConfirmationPayload { process_count },
        ) {
            eprintln!("failed to emit the quit confirmation request: {error}");
        }
    }
}

/// Every quit path (tray Quit, menu Quit, quit-on-close, system quit) calls this.
pub fn request_quit(app: &AppHandle) {
    request_quit_with(app, &app.state::<LifecycleCoordinator>());
}

#[cfg(test)]
mod tests {
    use std::{
        cell::{Cell, RefCell},
        fs,
        os::unix::fs::PermissionsExt,
        path::PathBuf,
        sync::{
            Mutex,
            atomic::{AtomicUsize, Ordering},
        },
    };

    use uuid::Uuid;

    use super::*;
    use crate::process_session::{EnvSpec, ExitInfo, LaunchSpec};

    fn exited() -> StopOutcome {
        StopOutcome::Terminated {
            exit: ExitInfo {
                code: None,
                signal: Some(15),
            },
            escalated_to_kill: false,
        }
    }

    /// A scripted process: running until stopped, then answers with `outcome`.
    struct Scripted {
        running: Mutex<bool>,
        outcome: StopOutcome,
        stops: AtomicUsize,
    }

    impl Scripted {
        fn new(outcome: StopOutcome) -> Arc<Self> {
            Arc::new(Self {
                running: Mutex::new(true),
                outcome,
                stops: AtomicUsize::new(0),
            })
        }

        fn stops(&self) -> usize {
            self.stops.load(Ordering::SeqCst)
        }

        fn exit_by_itself(&self) {
            *self.running.lock().unwrap() = false;
        }
    }

    impl OwnedProcess for Scripted {
        fn is_running(&self) -> bool {
            *self.running.lock().unwrap()
        }

        fn stop(&self, _grace: Duration, _kill_timeout: Duration) -> StopOutcome {
            self.stops.fetch_add(1, Ordering::SeqCst);
            if matches!(self.outcome, StopOutcome::Unconfirmed) {
                return StopOutcome::Unconfirmed;
            }
            *self.running.lock().unwrap() = false;
            self.outcome
        }
    }

    #[derive(Default)]
    struct FakeHost {
        exits: Cell<usize>,
        prompts: RefCell<Vec<usize>>,
    }

    impl QuitHost for FakeHost {
        fn exit_app(&self) {
            self.exits.set(self.exits.get() + 1);
        }

        fn show_confirmation(&self, process_count: usize) {
            self.prompts.borrow_mut().push(process_count);
        }
    }

    fn register(coordinator: &LifecycleCoordinator, label: &str, process: &Arc<Scripted>) {
        coordinator
            .registry()
            .register(label, process.clone())
            .expect("register");
    }

    #[test]
    fn lifecycle_quit_without_own_processes_exits_immediately() {
        let coordinator = LifecycleCoordinator::default();
        let host = FakeHost::default();

        request_quit_with(&host, &coordinator);

        assert_eq!(host.exits.get(), 1);
        assert!(host.prompts.borrow().is_empty());
    }

    #[test]
    fn lifecycle_quit_with_running_process_asks_first_and_does_not_exit() {
        let coordinator = LifecycleCoordinator::default();
        let host = FakeHost::default();
        let process = Scripted::new(exited());
        register(&coordinator, "caddy", &process);

        request_quit_with(&host, &coordinator);

        assert_eq!(host.exits.get(), 0);
        assert_eq!(*host.prompts.borrow(), vec![1]);
        assert_eq!(process.stops(), 0, "a request alone must stop nothing");
        assert!(process.is_running());
    }

    #[test]
    fn lifecycle_stop_and_quit_exits_only_after_all_exits_are_confirmed() {
        let coordinator = LifecycleCoordinator::default();
        let host = FakeHost::default();
        let first = Scripted::new(exited());
        let second = Scripted::new(StopOutcome::AlreadyExited(ExitInfo {
            code: Some(0),
            signal: None,
        }));
        register(&coordinator, "one", &first);
        register(&coordinator, "two", &second);
        request_quit_with(&host, &coordinator);

        let result = confirm_quit_with(&host, &coordinator).expect("confirm");

        assert_eq!(result, QuitResult::Quitting { stopped: 2 });
        assert_eq!(host.exits.get(), 1);
        assert_eq!((first.stops(), second.stops()), (1, 1));
        assert_eq!(coordinator.registry().running_count(), 0);
    }

    #[test]
    fn lifecycle_unconfirmed_exit_keeps_the_app_open_and_names_the_process() {
        let coordinator = LifecycleCoordinator::default();
        let host = FakeHost::default();
        let stubborn = Scripted::new(StopOutcome::Unconfirmed);
        let fine = Scripted::new(exited());
        register(&coordinator, "stubborn", &stubborn);
        register(&coordinator, "fine", &fine);
        request_quit_with(&host, &coordinator);

        let result = confirm_quit_with(&host, &coordinator).expect("confirm");

        assert_eq!(
            result,
            QuitResult::StopFailed {
                stopped: 1,
                unconfirmed: vec!["stubborn".to_owned()],
            }
        );
        assert_eq!(host.exits.get(), 0);
        // The unconfirmed entry is kept, not forgotten; the confirmed one is gone.
        assert_eq!(coordinator.registry().running_count(), 1);
        // The confirmation stays pending: retry is possible, quit-again re-asks.
        assert!(confirm_quit_with(&host, &coordinator).is_ok());
        assert_eq!(host.exits.get(), 0);
    }

    #[test]
    fn lifecycle_cancel_quit_changes_no_state() {
        let coordinator = LifecycleCoordinator::default();
        let host = FakeHost::default();
        let process = Scripted::new(exited());
        register(&coordinator, "caddy", &process);
        request_quit_with(&host, &coordinator);

        coordinator.cancel_quit().expect("cancel");

        assert_eq!(host.exits.get(), 0);
        assert_eq!(process.stops(), 0);
        assert!(process.is_running());
        assert_eq!(coordinator.registry().running_count(), 1);
        // The prompt is gone: confirming without a new request is refused and
        // stops nothing.
        assert!(coordinator.confirm_quit().is_err());
        assert_eq!(process.stops(), 0);
        // Quitting again asks again.
        request_quit_with(&host, &coordinator);
        assert_eq!(*host.prompts.borrow(), vec![1, 1]);
    }

    #[test]
    fn lifecycle_confirm_without_a_prompt_is_refused() {
        let coordinator = LifecycleCoordinator::default();
        let process = Scripted::new(exited());
        register(&coordinator, "caddy", &process);

        assert!(coordinator.confirm_quit().is_err());
        assert_eq!(process.stops(), 0);
    }

    #[test]
    fn lifecycle_exited_entries_are_pruned_and_deregistered_ones_are_not_stopped() {
        let coordinator = LifecycleCoordinator::default();
        let host = FakeHost::default();
        let gone = Scripted::new(exited());
        let kept = Scripted::new(exited());
        let deregistered = Scripted::new(exited());
        register(&coordinator, "gone", &gone);
        register(&coordinator, "kept", &kept);
        let id = coordinator
            .registry()
            .register("deregistered", deregistered.clone())
            .expect("register");
        gone.exit_by_itself();
        assert!(coordinator.registry().deregister(id));
        assert!(!coordinator.registry().deregister(id));

        request_quit_with(&host, &coordinator);
        assert_eq!(*host.prompts.borrow(), vec![1]);
        confirm_quit_with(&host, &coordinator).expect("confirm");

        assert_eq!(gone.stops(), 0);
        assert_eq!(deregistered.stops(), 0);
        assert_eq!(kept.stops(), 1);
    }

    #[test]
    fn lifecycle_all_processes_exiting_by_themselves_lets_the_quit_through() {
        let coordinator = LifecycleCoordinator::default();
        let host = FakeHost::default();
        let process = Scripted::new(exited());
        register(&coordinator, "caddy", &process);
        process.exit_by_itself();

        request_quit_with(&host, &coordinator);

        assert_eq!(host.exits.get(), 1);
        assert_eq!(coordinator.registry().running_count(), 0);
    }

    #[test]
    fn lifecycle_registry_labels_are_single_line_and_bounded() {
        let coordinator = LifecycleCoordinator::default();
        let stubborn = Scripted::new(StopOutcome::Unconfirmed);
        let label = format!("a\nb{}", "x".repeat(200));
        register(&coordinator, &label, &stubborn);
        coordinator.request_quit();

        let Ok(QuitOutcome::StopFailed { unconfirmed, .. }) = coordinator.confirm_quit() else {
            panic!("expected an unconfirmed stop");
        };
        assert_eq!(unconfirmed[0].chars().count(), MAX_LABEL_CHARS);
        assert!(!unconfirmed[0].contains('\n'));
    }

    #[test]
    fn lifecycle_stops_run_concurrently_without_holding_the_registry_lock() {
        // A process whose stop reads the registry would deadlock if the registry
        // lock were held while stopping.
        struct Probing {
            coordinator: Arc<LifecycleCoordinator>,
            running: Mutex<bool>,
        }
        impl OwnedProcess for Probing {
            fn is_running(&self) -> bool {
                *self.running.lock().unwrap()
            }
            fn stop(&self, _: Duration, _: Duration) -> StopOutcome {
                let _ = self.coordinator.registry().running_count();
                *self.running.lock().unwrap() = false;
                exited()
            }
        }

        let coordinator = Arc::new(LifecycleCoordinator::default());
        let probing = Arc::new(Probing {
            coordinator: Arc::clone(&coordinator),
            running: Mutex::new(true),
        });
        coordinator
            .registry()
            .register("probing", probing)
            .expect("register");
        coordinator.request_quit();

        assert_eq!(
            coordinator.confirm_quit().expect("confirm"),
            QuitOutcome::ReadyToExit { stopped: 1 }
        );
    }

    struct Fixture {
        dir: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!("userhome-lifecycle-{}", Uuid::new_v4()));
            fs::create_dir_all(&dir).expect("create fixture dir");
            Self {
                dir: fs::canonicalize(dir).expect("canonical fixture dir"),
            }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }

    #[test]
    fn lifecycle_stop_and_quit_really_stops_a_session_before_letting_the_app_exit() {
        let fixture = Fixture::new();
        let script = fixture.dir.join("run.sh");
        fs::write(&script, "#!/bin/sh\nsleep 60 &\nwait\n").expect("write script");
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).expect("chmod");
        let session = Arc::new(
            ProcessSession::start(
                &LaunchSpec::new(script, &fixture.dir).env(EnvSpec::new().inherit("PATH")),
            )
            .expect("start fixture process"),
        );
        let coordinator = LifecycleCoordinator::default()
            .with_stop_timeouts(Duration::from_secs(5), Duration::from_secs(2));
        coordinator
            .registry()
            .register("fixture", session.clone())
            .expect("register");
        let host = FakeHost::default();

        request_quit_with(&host, &coordinator);
        assert_eq!(host.exits.get(), 0);
        assert!(session.is_running());

        let result = confirm_quit_with(&host, &coordinator).expect("confirm");

        assert_eq!(result, QuitResult::Quitting { stopped: 1 });
        assert_eq!(host.exits.get(), 1);
        assert_eq!(session.status().state, SessionState::Exited);
        assert_eq!(coordinator.registry().running_count(), 0);
    }
}
