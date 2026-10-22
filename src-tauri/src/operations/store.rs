use std::{collections::HashMap, sync::Arc};

use crate::error::AppError;

use crate::process_session::StopOutcome;

use super::{
    Clock, DEFAULT_MAX_OPERATION_RECORDS, MAX_OPERATION_EVENTS, MAX_PROGRESS_MESSAGE_BYTES,
    MAX_RESULT_SUMMARY_BYTES, MIN_SENSITIVE_VALUE_BYTES, OperationDetails, OperationEvent,
    OperationIdSource, OperationIntent, OperationPreview, OperationStatus, OperationSummary,
    PREVIEW_TTL_MILLIS, StoppableProcess, format_timestamp, redact_error, sanitize_payload,
    system_clock, system_id_source,
};

struct OperationRecord {
    details: OperationDetails,
    intent: Option<OperationIntent>,
    expires_at_millis: u64,
    next_sequence: u64,
    process: Option<Arc<dyn StoppableProcess>>,
}

/// What the caller of [`OperationStore::begin_cancel`] has to do next.
pub enum CancelStep {
    /// Nothing is left to stop; this is the operation's current state.
    Settled(OperationDetails),
    /// The operation is `Cancelling`; stop this process (without holding the
    /// store lock), then report the outcome with [`OperationStore::finish_stop`].
    Stop(Arc<dyn StoppableProcess>),
}

pub struct OperationStore {
    clock: Arc<dyn Clock>,
    id_source: Arc<dyn OperationIdSource>,
    records: HashMap<String, OperationRecord>,
    order: Vec<String>,
    active_mutation: Option<String>,
    max_records: usize,
    max_events: usize,
    dropped_records: u64,
    /// Known sensitive values, longest first so overlapping values mask fully.
    sensitive: Vec<String>,
}

impl Default for OperationStore {
    fn default() -> Self {
        Self::with_sources(system_clock(), system_id_source())
    }
}

impl OperationStore {
    pub fn with_sources(clock: Arc<dyn Clock>, id_source: Arc<dyn OperationIdSource>) -> Self {
        Self {
            clock,
            id_source,
            records: HashMap::new(),
            order: Vec::new(),
            active_mutation: None,
            max_records: DEFAULT_MAX_OPERATION_RECORDS,
            max_events: MAX_OPERATION_EVENTS,
            dropped_records: 0,
            sensitive: Vec::new(),
        }
    }

    /// Overrides the history bounds (at least one record and two events, so a
    /// final event always fits next to progress).
    pub fn with_limits(mut self, max_records: usize, max_events: usize) -> Self {
        self.max_records = max_records.max(1);
        self.max_events = max_events.max(2);
        self
    }

    /// Number of records dropped so far to stay within the record bound.
    pub fn dropped_records(&self) -> u64 {
        self.dropped_records
    }

    /// Registers known sensitive values and redacts what is already recorded.
    /// Values shorter than [`MIN_SENSITIVE_VALUE_BYTES`] are ignored.
    pub fn register_sensitive_values(&mut self, values: impl IntoIterator<Item = String>) {
        for value in values {
            if value.len() >= MIN_SENSITIVE_VALUE_BYTES && !self.sensitive.contains(&value) {
                self.sensitive.push(value);
            }
        }
        self.sensitive
            .sort_by_key(|value| std::cmp::Reverse(value.len()));

        let known = self.sensitive.clone();
        for record in self.records.values_mut() {
            let details = &mut record.details;
            details.summary =
                sanitize_payload(&details.summary, MAX_PROGRESS_MESSAGE_BYTES, &known);
            for effect in &mut details.effects {
                *effect = sanitize_payload(effect, MAX_PROGRESS_MESSAGE_BYTES, &known);
            }
            for event in &mut details.events {
                match event {
                    OperationEvent::Progress { message, .. } => {
                        *message = sanitize_payload(message, MAX_PROGRESS_MESSAGE_BYTES, &known);
                    }
                    OperationEvent::Finished {
                        stdout_summary,
                        stderr_summary,
                        error,
                        ..
                    } => {
                        for summary in [stdout_summary, stderr_summary].into_iter().flatten() {
                            *summary = sanitize_payload(summary, MAX_RESULT_SUMMARY_BYTES, &known);
                        }
                        if let Some(current) = error.take() {
                            *error = Some(redact_error(current, &known));
                        }
                    }
                }
            }
        }
    }

    /// Connects a running operation to the own process its cancellation stops.
    pub fn attach_process(
        &mut self,
        operation_id: &str,
        process: Arc<dyn StoppableProcess>,
    ) -> Result<(), AppError> {
        let record = self
            .records
            .get_mut(operation_id)
            .ok_or_else(AppError::operation_not_found)?;
        if record.details.status != OperationStatus::Running {
            return Err(AppError::invalid_operation_state());
        }
        record.process = Some(process);
        Ok(())
    }

    pub fn preview(
        &mut self,
        intent: OperationIntent,
        summary: &str,
        effects: Vec<String>,
    ) -> Result<OperationPreview, AppError> {
        let operation_id = self.id_source.next_id();
        if self.records.contains_key(&operation_id) {
            return Err(AppError::internal());
        }

        let expires_at_millis = self
            .clock
            .monotonic_millis()
            .saturating_add(PREVIEW_TTL_MILLIS);
        let expires_at = format_timestamp(
            self.clock
                .unix_seconds()
                .saturating_add((PREVIEW_TTL_MILLIS / 1_000) as i64),
        )?;
        let preview = OperationPreview {
            operation_id: operation_id.clone(),
            summary: sanitize_payload(summary, MAX_PROGRESS_MESSAGE_BYTES, &self.sensitive),
            effects: effects
                .into_iter()
                .map(|effect| {
                    sanitize_payload(&effect, MAX_PROGRESS_MESSAGE_BYTES, &self.sensitive)
                })
                .collect(),
            expires_at,
        };
        let details = OperationDetails {
            operation_id: preview.operation_id.clone(),
            summary: preview.summary.clone(),
            effects: preview.effects.clone(),
            expires_at: preview.expires_at.clone(),
            status: OperationStatus::Previewed,
            events: Vec::new(),
            dropped_events: 0,
            dropped_records: 0,
        };

        self.evict_for_new_record();
        self.records.insert(
            operation_id.clone(),
            OperationRecord {
                details,
                intent: Some(intent),
                expires_at_millis,
                next_sequence: 1,
                process: None,
            },
        );
        self.order.push(operation_id);

        Ok(preview)
    }

    pub fn authorize_mutation(
        &mut self,
        operation_id: &str,
        intent: &OperationIntent,
    ) -> Result<OperationDetails, AppError> {
        {
            let record = self
                .records
                .get_mut(operation_id)
                .ok_or_else(AppError::operation_not_found)?;

            if record.details.status != OperationStatus::Previewed {
                return Err(AppError::invalid_operation_state());
            }

            if self.clock.monotonic_millis() >= record.expires_at_millis {
                record.details.status = OperationStatus::Expired;
                record.intent = None;
                return Err(AppError::operation_expired());
            }

            if record.intent.as_ref() != Some(intent) {
                return Err(AppError::operation_mismatch());
            }
        }

        if self.active_mutation.is_some() {
            return Err(AppError::operation_busy());
        }

        let record = self
            .records
            .get_mut(operation_id)
            .ok_or_else(AppError::operation_not_found)?;
        record.intent = None;
        record.details.status = OperationStatus::Running;
        self.active_mutation = Some(operation_id.to_owned());

        self.get(operation_id)
    }

    pub fn record_progress(
        &mut self,
        operation_id: &str,
        message: &str,
    ) -> Result<OperationEvent, AppError> {
        let message = sanitize_payload(message, MAX_PROGRESS_MESSAGE_BYTES, &self.sensitive);
        let max_events = self.max_events;
        let record = self.running_record_mut(operation_id)?;
        let event = OperationEvent::Progress {
            operation_id: operation_id.to_owned(),
            sequence: record.next_sequence,
            message,
        };
        record.next_sequence += 1;

        // Keep one slot free so the final event always fits.
        while record.details.events.len() >= max_events - 1 {
            record.details.events.remove(0);
            record.details.dropped_events += 1;
        }
        record.details.events.push(event.clone());

        Ok(event)
    }

    pub fn cancel(&mut self, operation_id: &str) -> Result<OperationDetails, AppError> {
        let status = self
            .records
            .get(operation_id)
            .ok_or_else(AppError::operation_not_found)?
            .details
            .status;

        match status {
            OperationStatus::Previewed => {
                self.finish(operation_id, OperationStatus::Cancelled, None, None, None)?;
            }
            OperationStatus::Running => {
                self.records
                    .get_mut(operation_id)
                    .ok_or_else(AppError::operation_not_found)?
                    .details
                    .status = OperationStatus::Cancelling;
            }
            OperationStatus::Cancelling
            | OperationStatus::Succeeded
            | OperationStatus::Failed
            | OperationStatus::Cancelled
            | OperationStatus::Expired => {}
        }

        self.get(operation_id)
    }

    pub fn acknowledge_cancelled(
        &mut self,
        operation_id: &str,
    ) -> Result<OperationEvent, AppError> {
        let status = self
            .records
            .get(operation_id)
            .ok_or_else(AppError::operation_not_found)?
            .details
            .status;
        if status != OperationStatus::Cancelling {
            return Err(AppError::invalid_operation_state());
        }

        self.finish(operation_id, OperationStatus::Cancelled, None, None, None)
    }

    /// Starts a cancellation. A running operation with an attached process moves
    /// to `Cancelling` and hands the process back to be stopped; only the first
    /// caller gets it, later calls just see `Cancelling`. Anything else behaves
    /// like [`OperationStore::cancel`].
    pub fn begin_cancel(&mut self, operation_id: &str) -> Result<CancelStep, AppError> {
        let was_running = self
            .records
            .get(operation_id)
            .ok_or_else(AppError::operation_not_found)?
            .details
            .status
            == OperationStatus::Running;
        let details = self.cancel(operation_id)?;
        let process = self
            .records
            .get(operation_id)
            .and_then(|record| record.process.clone())
            .filter(|_| was_running);
        Ok(match process {
            Some(process) => CancelStep::Stop(process),
            None => CancelStep::Settled(details),
        })
    }

    /// Records the result of stopping the attached process. Only a confirmed
    /// exit ends as `Cancelled`; otherwise the operation is `Failed`, because the
    /// process may still be running.
    pub fn finish_stop(
        &mut self,
        operation_id: &str,
        outcome: StopOutcome,
        stdout: &str,
        stderr: &str,
    ) -> Result<OperationEvent, AppError> {
        let stdout = (!stdout.is_empty()).then_some(stdout);
        let stderr = (!stderr.is_empty()).then_some(stderr);
        match outcome {
            StopOutcome::AlreadyExited(_) | StopOutcome::Terminated { .. } => self.finish(
                operation_id,
                OperationStatus::Cancelled,
                stdout,
                stderr,
                None,
            ),
            StopOutcome::Unconfirmed => self.finish_failure(
                operation_id,
                AppError::process_failed(
                    "The process exit could not be confirmed; it may still be running.",
                    true,
                ),
                stdout,
                stderr,
            ),
        }
    }

    pub fn finish_success(
        &mut self,
        operation_id: &str,
        stdout: Option<&str>,
        stderr: Option<&str>,
    ) -> Result<OperationEvent, AppError> {
        self.finish(
            operation_id,
            OperationStatus::Succeeded,
            stdout,
            stderr,
            None,
        )
    }

    pub fn finish_failure(
        &mut self,
        operation_id: &str,
        error: AppError,
        stdout: Option<&str>,
        stderr: Option<&str>,
    ) -> Result<OperationEvent, AppError> {
        self.finish(
            operation_id,
            OperationStatus::Failed,
            stdout,
            stderr,
            Some(error),
        )
    }

    pub fn list(&self) -> Vec<OperationSummary> {
        self.order
            .iter()
            .rev()
            .filter_map(|operation_id| self.records.get(operation_id))
            .map(|record| OperationSummary {
                operation_id: record.details.operation_id.clone(),
                summary: record.details.summary.clone(),
                status: record.details.status,
            })
            .collect()
    }

    pub fn get(&self, operation_id: &str) -> Result<OperationDetails, AppError> {
        self.records
            .get(operation_id)
            .map(|record| OperationDetails {
                dropped_records: self.dropped_records,
                ..record.details.clone()
            })
            .ok_or_else(AppError::operation_not_found)
    }

    /// Makes room for one more record by dropping the oldest ones that are not
    /// active. Running and cancelling operations are never dropped.
    fn evict_for_new_record(&mut self) {
        while self.order.len() >= self.max_records {
            let evictable = self.order.iter().position(|id| {
                self.records.get(id).is_none_or(|record| {
                    !matches!(
                        record.details.status,
                        OperationStatus::Running | OperationStatus::Cancelling
                    )
                })
            });
            let Some(index) = evictable else {
                return;
            };
            let id = self.order.remove(index);
            if self.records.remove(&id).is_some() {
                self.dropped_records += 1;
            }
        }
    }

    fn running_record_mut(&mut self, operation_id: &str) -> Result<&mut OperationRecord, AppError> {
        let record = self
            .records
            .get_mut(operation_id)
            .ok_or_else(AppError::operation_not_found)?;
        if !matches!(
            record.details.status,
            OperationStatus::Running | OperationStatus::Cancelling
        ) {
            return Err(AppError::invalid_operation_state());
        }
        Ok(record)
    }

    fn finish(
        &mut self,
        operation_id: &str,
        status: OperationStatus,
        stdout: Option<&str>,
        stderr: Option<&str>,
        error: Option<AppError>,
    ) -> Result<OperationEvent, AppError> {
        let max_events = self.max_events;
        let known = &self.sensitive;
        let record = self
            .records
            .get_mut(operation_id)
            .ok_or_else(AppError::operation_not_found)?;
        let can_finish = match status {
            OperationStatus::Cancelled => matches!(
                record.details.status,
                OperationStatus::Previewed | OperationStatus::Cancelling
            ),
            OperationStatus::Succeeded | OperationStatus::Failed => matches!(
                record.details.status,
                OperationStatus::Running | OperationStatus::Cancelling
            ),
            _ => false,
        };
        if !can_finish {
            return Err(AppError::invalid_operation_state());
        }

        record.intent = None;
        record.process = None;
        record.details.status = status;
        let event = OperationEvent::Finished {
            operation_id: operation_id.to_owned(),
            sequence: record.next_sequence,
            status,
            stdout_summary: stdout
                .map(|value| sanitize_payload(value, MAX_RESULT_SUMMARY_BYTES, known)),
            stderr_summary: stderr
                .map(|value| sanitize_payload(value, MAX_RESULT_SUMMARY_BYTES, known)),
            error: error.map(|error| redact_error(error, known)),
        };
        record.next_sequence += 1;

        while record.details.events.len() >= max_events {
            record.details.events.remove(0);
            record.details.dropped_events += 1;
        }
        record.details.events.push(event.clone());

        if self.active_mutation.as_deref() == Some(operation_id) {
            self.active_mutation = None;
        }

        Ok(event)
    }
}
