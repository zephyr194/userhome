use tauri::State;

use crate::deep_link::{NavigationIntent, PendingDeepLink};

/// Hands over the link that opened the app before the frontend was ready; read once.
#[tauri::command]
pub fn take_pending_deep_link(pending: State<'_, PendingDeepLink>) -> Option<NavigationIntent> {
    pending.take()
}
