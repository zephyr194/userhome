use std::{collections::HashMap, sync::Arc};

use crate::error::AppError;

use super::{
    Clock, MAX_OPERATION_EVENTS, MAX_PROGRESS_MESSAGE_BYTES, MAX_RESULT_SUMMARY_BYTES,
    OperationDetails, OperationEvent, OperationIdSource, OperationIntent, OperationPreview,
    OperationStatus, OperationSummary, PREVIEW_TTL_MILLIS, format_timestamp, sanitize_payload,
    system_clock, system_id_source,
};

struct OperationRecord {
    details: OperationDetails,
    intent: Option<OperationIntent>,
    expires_at_millis: u64,
    next_sequence: u64,
}

pub struct OperationStore {
    clock: Arc<dyn Clock>,
    id_source: Arc<dyn OperationIdSource>,
    records: HashMap<String, OperationRecord>,
    order: Vec<String>,
    active_mutation: Option<String>,
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
        }
    }

    pub fn preview(
        &mut self,
        intent: OperationIntent,
        summary: &str,
        effects: Vec<String>,
        requires_elevation: bool,
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
            summary: sanitize_payload(summary, MAX_PROGRESS_MESSAGE_BYTES),
            effects: effects
                .into_iter()
                .map(|effect| sanitize_payload(&effect, MAX_PROGRESS_MESSAGE_BYTES))
                .collect(),
            requires_elevation,
            expires_at,
        };
        let details = OperationDetails {
            operation_id: preview.operation_id.clone(),
            summary: preview.summary.clone(),
            effects: preview.effects.clone(),
            requires_elevation: preview.requires_elevation,
            expires_at: preview.expires_at.clone(),
            status: OperationStatus::Previewed,
            events: Vec::new(),
        };

        self.records.insert(
            operation_id.clone(),
            OperationRecord {
                details,
                intent: Some(intent),
                expires_at_millis,
                next_sequence: 1,
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

        Ok(record.details.clone())
    }

    pub fn record_progress(
        &mut self,
        operation_id: &str,
        message: &str,
    ) -> Result<OperationEvent, AppError> {
        let record = self.running_record_mut(operation_id)?;
        let event = OperationEvent::Progress {
            operation_id: operation_id.to_owned(),
            sequence: record.next_sequence,
            message: sanitize_payload(message, MAX_PROGRESS_MESSAGE_BYTES),
        };
        record.next_sequence += 1;

        if record.details.events.len() >= MAX_OPERATION_EVENTS - 1 {
            record.details.events.remove(0);
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
            .map(|record| record.details.clone())
            .ok_or_else(AppError::operation_not_found)
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
        record.details.status = status;
        let event = OperationEvent::Finished {
            operation_id: operation_id.to_owned(),
            sequence: record.next_sequence,
            status,
            stdout_summary: stdout.map(|value| sanitize_payload(value, MAX_RESULT_SUMMARY_BYTES)),
            stderr_summary: stderr.map(|value| sanitize_payload(value, MAX_RESULT_SUMMARY_BYTES)),
            error,
        };
        record.next_sequence += 1;

        while record.details.events.len() >= MAX_OPERATION_EVENTS {
            record.details.events.remove(0);
        }
        record.details.events.push(event.clone());

        if self.active_mutation.as_deref() == Some(operation_id) {
            self.active_mutation = None;
        }

        Ok(event)
    }
}
