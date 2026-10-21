//! Built-in registry of known application configuration files. Entries are
//! static data reviewed in code; nothing in this module probes or reads files.

pub mod registry;

#[cfg(test)]
mod tests;
