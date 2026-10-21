//! Adoption of existing user launchd jobs. A job is admitted only when its plist
//! reads without ambiguity and uses no launch semantics UserHome cannot show
//! faithfully. Admission never changes the plist. A structured edit additionally
//! needs the plist to survive a parse, serialize and parse again unchanged.

pub mod store;

#[cfg(test)]
mod tests;

use std::{collections::HashSet, io::Cursor};

use quick_xml::{NsReader, events::Event};
use serde::Serialize;

use crate::config::read::hash_bytes;

use super::{
    launchd::LaunchdService,
    ownership::{AdoptionRecords, Ownership, ReadOnlyReason, assess},
};

pub const MAX_PLIST_BYTES: usize = 512 * 1024;
pub const LABEL_KEY: &str = "Label";

/// Launch semantics UserHome's model cannot explain: event triggers and
/// privilege switches. A job that uses one stays read-only. Every other key is
/// kept as it is, whether or not UserHome knows it.
pub const UNSUPPORTED_LAUNCH_KEYS: [&str; 8] = [
    "Sockets",
    "MachServices",
    "LaunchEvents",
    "WatchPaths",
    "QueueDirectories",
    "StartCalendarInterval",
    "UserName",
    "GroupName",
];

const BINARY_MAGIC: &[u8] = b"bplist";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Refusal {
    AlreadyManaged,
    ReadOnly(ReadOnlyReason),
    TooLarge,
    BinaryFormat,
    Malformed,
    NotDictionary,
    DuplicateKey,
    LabelMissing,
    LabelMismatch,
    UnsupportedLaunchKey,
    Comments,
    RoundTripChanged,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Admitted {
    pub sha256: String,
}

struct Document {
    dictionary: plist::Dictionary,
    unique_keys: bool,
    has_comments: bool,
}

struct XmlScan {
    unique_keys: bool,
    has_comments: bool,
}

fn read_document(bytes: &[u8]) -> Result<Document, Refusal> {
    if bytes.len() > MAX_PLIST_BYTES {
        return Err(Refusal::TooLarge);
    }
    if bytes.starts_with(BINARY_MAGIC) {
        return Err(Refusal::BinaryFormat);
    }
    let value =
        plist::Value::from_reader_xml(Cursor::new(bytes)).map_err(|_| Refusal::Malformed)?;
    let plist::Value::Dictionary(dictionary) = value else {
        return Err(Refusal::NotDictionary);
    };
    let scan = scan_xml(bytes).map_err(|_| Refusal::Malformed)?;
    Ok(Document {
        dictionary,
        unique_keys: scan.unique_keys,
        has_comments: scan.has_comments,
    })
}

/// The `plist` crate keeps the last of two equal keys without a word, at any
/// depth, so duplicates and comments are found by reading the XML itself.
fn scan_xml(bytes: &[u8]) -> Result<XmlScan, ()> {
    let text = std::str::from_utf8(bytes).map_err(|_| ())?;
    let mut reader = NsReader::from_str(text);
    let mut dictionaries: Vec<HashSet<String>> = Vec::new();
    let mut key: Option<String> = None;
    let mut unique_keys = true;
    let mut has_comments = false;
    loop {
        match reader.read_event().map_err(|_| ())? {
            Event::Start(start) => {
                if key.is_some() {
                    return Err(());
                }
                match start.local_name().as_ref() {
                    "dict" => dictionaries.push(HashSet::new()),
                    "key" => key = Some(String::new()),
                    _ => {}
                }
            }
            Event::End(end) => {
                if let Some(raw) = key.take() {
                    let decoded = quick_xml::escape::unescape(&raw).map_err(|_| ())?;
                    record_key(&mut dictionaries, decoded.into_owned(), &mut unique_keys);
                } else if end.local_name().as_ref() == "dict" {
                    dictionaries.pop();
                }
            }
            Event::Empty(start) => {
                if start.local_name().as_ref() == "key" {
                    record_key(&mut dictionaries, String::new(), &mut unique_keys);
                }
            }
            Event::Text(text) => {
                if let Some(raw) = key.as_mut() {
                    raw.push_str(&text);
                }
            }
            Event::GeneralRef(reference) => {
                if let Some(raw) = key.as_mut() {
                    raw.push_str(&format!("&{};", &*reference));
                }
            }
            Event::CData(_) if key.is_some() => return Err(()),
            Event::Comment(_) => has_comments = true,
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(XmlScan {
        unique_keys,
        has_comments,
    })
}

fn record_key(dictionaries: &mut [HashSet<String>], key: String, unique_keys: &mut bool) {
    if let Some(current) = dictionaries.last_mut()
        && !current.insert(key)
    {
        *unique_keys = false;
    }
}

fn identity_refusals(document: &Document, label: &str, refusals: &mut Vec<Refusal>) {
    match document.dictionary.get(LABEL_KEY) {
        Some(plist::Value::String(found)) if found.as_str() == label => {}
        Some(plist::Value::String(_)) => refusals.push(Refusal::LabelMismatch),
        _ => refusals.push(Refusal::LabelMissing),
    }
    if !document.unique_keys {
        refusals.push(Refusal::DuplicateKey);
    }
    if UNSUPPORTED_LAUNCH_KEYS
        .iter()
        .any(|key| document.dictionary.contains_key(key))
    {
        refusals.push(Refusal::UnsupportedLaunchKey);
    }
}

/// Decides whether the current user's job may be adopted. Every refusal is
/// returned, so a caller can say why. `bytes` must be the content of the one
/// plist the discovery found for this job; the caller reads it.
pub fn admit(
    service: &LaunchdService,
    uid: u32,
    adoptions: &dyn AdoptionRecords,
    discovery_trusted: bool,
    bytes: &[u8],
) -> Result<Admitted, Vec<Refusal>> {
    let mut refusals = Vec::new();
    let assessment = assess(service, uid, adoptions, discovery_trusted);
    match assessment.ownership {
        Ownership::CurrentUserAgent => {}
        Ownership::UserhomeAdopted | Ownership::UserhomeCreated => {
            refusals.push(Refusal::AlreadyManaged);
        }
        _ => {}
    }
    for reason in assessment.read_only_reasons {
        if reason != ReadOnlyReason::NotAdopted {
            refusals.push(Refusal::ReadOnly(reason));
        }
    }
    match read_document(bytes) {
        Ok(document) => identity_refusals(&document, &service.label, &mut refusals),
        Err(refusal) => refusals.push(refusal),
    }
    if refusals.is_empty() {
        Ok(Admitted {
            sha256: hash_bytes(bytes),
        })
    } else {
        Err(refusals)
    }
}

/// The dictionary a structured edit may start from. Comments and duplicate keys
/// cannot survive a rewrite, and a plist that does not survive
/// [`render`] unchanged is refused rather than repaired.
pub fn editable_document(bytes: &[u8]) -> Result<plist::Dictionary, Refusal> {
    let document = read_document(bytes)?;
    if !document.unique_keys {
        return Err(Refusal::DuplicateKey);
    }
    if document.has_comments {
        return Err(Refusal::Comments);
    }
    render(&document.dictionary)?;
    Ok(document.dictionary)
}

/// Serializes `dictionary` as XML and proves the bytes parse back to the same
/// value. Only bytes that pass are written.
pub fn render(dictionary: &plist::Dictionary) -> Result<Vec<u8>, Refusal> {
    let value = plist::Value::Dictionary(dictionary.clone());
    let mut bytes = Vec::new();
    value
        .to_writer_xml(&mut bytes)
        .map_err(|_| Refusal::RoundTripChanged)?;
    let reparsed = plist::Value::from_reader_xml(Cursor::new(&bytes))
        .map_err(|_| Refusal::RoundTripChanged)?;
    if reparsed != value {
        return Err(Refusal::RoundTripChanged);
    }
    Ok(bytes)
}
