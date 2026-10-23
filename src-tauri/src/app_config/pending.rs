//! Short-lived, single-use previews. Confirming requires a token from a preview,
//! and the token binds the exact text that was previewed.

use std::{
    path::PathBuf,
    sync::Mutex,
    time::{Duration, Instant},
};

use crate::error::AppError;

const MAX_PENDING: usize = 8;
const PREVIEW_TTL: Duration = Duration::from_secs(10 * 60);

pub struct PendingEdit {
    pub token: String,
    pub entry_id: &'static str,
    pub path: PathBuf,
    pub exists: bool,
    pub before_hash: String,
    pub proposed: String,
    pub created: Instant,
}

#[derive(Default)]
pub struct AppConfigEditState {
    pending: Mutex<Vec<PendingEdit>>,
}

impl AppConfigEditState {
    pub fn remember(&self, edit: PendingEdit) -> Result<(), AppError> {
        self.remember_at(edit, Instant::now())
    }

    pub fn take(&self, token: &str) -> Result<PendingEdit, AppError> {
        self.take_at(token, Instant::now())
    }

    pub(crate) fn remember_at(&self, edit: PendingEdit, now: Instant) -> Result<(), AppError> {
        let mut pending = self.pending.lock().map_err(|_| AppError::internal())?;
        prune(&mut pending, now);
        if pending.len() >= MAX_PENDING {
            pending.remove(0);
        }
        pending.push(edit);
        Ok(())
    }

    pub(crate) fn take_at(&self, token: &str, now: Instant) -> Result<PendingEdit, AppError> {
        let mut pending = self.pending.lock().map_err(|_| AppError::internal())?;
        prune(&mut pending, now);
        let index = pending
            .iter()
            .position(|edit| edit.token == token)
            .ok_or_else(|| AppError::not_found("预览已失效，请重新预览。"))?;
        Ok(pending.remove(index))
    }
}

fn prune(pending: &mut Vec<PendingEdit>, now: Instant) {
    pending.retain(|edit| now.duration_since(edit.created) < PREVIEW_TTL);
}
