pub mod command;
pub mod detect;
pub mod read;
pub mod registry;
pub mod terminal;
pub mod validate;
pub mod write;

#[cfg(test)]
mod claude_snapshot_tests;
#[cfg(test)]
mod codex_snapshot_tests;
#[cfg(test)]
mod gemini_snapshot_tests;
#[cfg(test)]
mod read_tests;
#[cfg(test)]
mod schema_tests;
