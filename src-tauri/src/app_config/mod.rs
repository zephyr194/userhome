//! Built-in registry of known application configuration files. Entries are
//! static data reviewed in code. Probing and reading go through an injectable
//! `ConfigFs` and only ever name registered paths.

pub mod discover;
pub mod edit;
pub mod patch;
pub mod patch_ini;
pub mod patch_toml;
pub mod pending;
pub mod read;
pub mod registry;
pub mod schema;

#[cfg(test)]
mod discover_tests;
#[cfg(test)]
mod edit_tests;
#[cfg(test)]
mod read_tests;
#[cfg(test)]
pub(crate) mod test_support;
#[cfg(test)]
mod tests;
