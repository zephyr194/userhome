//! Registry data model. Entries are static, code-reviewed records; the registry
//! never probes or reads the filesystem itself.

use std::path::{Path, PathBuf};

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Category {
    Editor,
    AiClient,
    Terminal,
    DeveloperTool,
    System,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    Json,
    Jsonc,
    Toml,
    Plist,
    Ini,
    Dotenv,
    Text,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Capability {
    DiscoverOnly,
    ReadOnly,
    Writable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Sensitivity {
    None,
    SensitiveKeys,
    Credentials,
}

/// `Home` is relative to `$HOME`; `Fixed` is an absolute path outside it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Location {
    Home(&'static str),
    Fixed(&'static str),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Source {
    pub url: &'static str,
    pub verified_on: &'static str,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Entry {
    pub id: &'static str,
    pub name: &'static str,
    pub category: Category,
    pub location: Location,
    pub format: Format,
    pub capability: Capability,
    pub sensitivity: Sensitivity,
    pub metadata_only: bool,
    pub source: Source,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RegistryError {
    UnknownEntry(String),
}

pub struct Registry {
    entries: Vec<Entry>,
}

impl Registry {
    pub fn new(entries: Vec<Entry>) -> Self {
        Self { entries }
    }

    pub fn entries(&self) -> &[Entry] {
        &self.entries
    }

    pub fn get(&self, id: &str) -> Result<&Entry, RegistryError> {
        self.entries
            .iter()
            .find(|entry| entry.id == id)
            .ok_or_else(|| RegistryError::UnknownEntry(id.to_owned()))
    }
}

/// Joins the entry's location onto `home`. Pure string work; the caller decides
/// what to do with the result.
pub fn resolve_path(entry: &Entry, home: &Path) -> PathBuf {
    match entry.location {
        Location::Home(relative) => home.join(relative),
        Location::Fixed(absolute) => PathBuf::from(absolute),
    }
}

pub fn display_path(entry: &Entry) -> String {
    match entry.location {
        Location::Home(relative) => format!("~/{relative}"),
        Location::Fixed(absolute) => absolute.to_owned(),
    }
}

/// The only view of an entry the frontend receives. It carries the `~/` display
/// path, never the resolved `$HOME` directory, and no file content.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EntrySummary {
    pub id: String,
    pub name: String,
    pub category: Category,
    pub display_path: String,
    pub format: Format,
    pub capability: Capability,
    pub sensitivity: Sensitivity,
    pub metadata_only: bool,
    pub source_url: String,
    pub verified_on: String,
}

impl From<&Entry> for EntrySummary {
    fn from(entry: &Entry) -> Self {
        Self {
            id: entry.id.to_owned(),
            name: entry.name.to_owned(),
            category: entry.category,
            display_path: display_path(entry),
            format: entry.format,
            capability: entry.capability,
            sensitivity: entry.sensitivity,
            metadata_only: entry.metadata_only,
            source_url: entry.source.url.to_owned(),
            verified_on: entry.source.verified_on.to_owned(),
        }
    }
}

#[cfg(test)]
pub fn fixture(id: &'static str) -> Entry {
    Entry {
        id,
        name: "Fixture tool",
        category: Category::DeveloperTool,
        location: Location::Home(".fixture/config.json"),
        format: Format::Json,
        capability: Capability::ReadOnly,
        sensitivity: Sensitivity::None,
        metadata_only: false,
        source: Source {
            url: "https://example.com/docs",
            verified_on: "2026-10-21",
        },
    }
}
