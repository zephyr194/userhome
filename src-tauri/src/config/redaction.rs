//! Secret-key heuristic shared by every consumer: config file masking
//! (`app_config::read`, `ai_config`), key/value patching and profile field
//! validation. There is one normalization and one fragment list so the callers
//! cannot drift apart again.

const SECRET_KEY_FRAGMENTS: [&str; 7] = [
    "token",
    "password",
    "passwd",
    "secret",
    "credential",
    "key",
    "auth",
];

/// Matches the normalized key (alphanumerics only, lowercase), so `api-key`,
/// `API_KEY`, `api.key` and `apiKey` agree. Deliberately broad: a false positive
/// hides a value or rejects a profile field, a false negative leaks it.
pub fn is_secret_key(key: &str) -> bool {
    let normalized: String = key
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect();
    SECRET_KEY_FRAGMENTS
        .iter()
        .any(|fragment| normalized.contains(fragment))
}

#[cfg(test)]
#[path = "redaction_tests.rs"]
mod tests;
