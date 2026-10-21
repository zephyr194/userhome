//! Keeps the certificate, the private key and their directories out of anything
//! a Caddy session stores or reports. Matching ignores ASCII case, so a path
//! printed with other casing is still replaced.

use std::{
    path::Path,
    sync::{Arc, Mutex, PoisonError},
};

use crate::{
    caddy::tls::{TlsPaths, caddy_safe_path},
    process_session::OutputFilter,
};

pub const CERTIFICATE_LABEL: &str = "<证书文件>";
pub const PRIVATE_KEY_LABEL: &str = "<私钥文件>";
pub const TLS_DIRECTORY_LABEL: &str = "<TLS 目录>";
/// Longest output held back while no line break arrives.
const MAX_HELD_BYTES: usize = 16 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SensitivePath {
    text: String,
    label: &'static str,
}

impl SensitivePath {
    fn new(path: &Path, label: &'static str) -> Option<Self> {
        let text = caddy_safe_path(path).ok()?;
        (text.len() > 1).then(|| Self {
            text: text.to_owned(),
            label,
        })
    }
}

/// Only paths that Caddy can receive from a configuration are listed; the others
/// cannot appear in its output.
pub fn sensitive_paths(resolved: &[TlsPaths]) -> Vec<SensitivePath> {
    let mut paths: Vec<SensitivePath> = Vec::new();
    for entry in resolved {
        for (file, label) in [
            (&entry.certificate, CERTIFICATE_LABEL),
            (&entry.private_key, PRIVATE_KEY_LABEL),
        ] {
            push_unique(&mut paths, SensitivePath::new(file, label));
            if let Some(directory) = file.parent() {
                push_unique(
                    &mut paths,
                    SensitivePath::new(directory, TLS_DIRECTORY_LABEL),
                );
            }
        }
    }
    paths
}

fn push_unique(paths: &mut Vec<SensitivePath>, path: Option<SensitivePath>) {
    if let Some(path) = path.filter(|path| !paths.contains(path)) {
        paths.push(path);
    }
}

pub fn redact_text(text: &str, known: &[SensitivePath]) -> String {
    let mut longest_first: Vec<&SensitivePath> = known.iter().collect();
    longest_first.sort_by_key(|path| std::cmp::Reverse(path.text.len()));
    longest_first
        .into_iter()
        .fold(text.to_owned(), |text, path| replace_path(&text, path))
}

/// `to_ascii_lowercase` keeps every byte offset, so positions found in the
/// lowered copy index the original text.
fn replace_path(text: &str, path: &SensitivePath) -> String {
    let haystack = text.to_ascii_lowercase();
    let needle = path.text.to_ascii_lowercase();
    let mut output = String::with_capacity(text.len());
    let mut cursor = 0;
    while let Some(offset) = haystack[cursor..].find(&needle) {
        let start = cursor + offset;
        output.push_str(&text[cursor..start]);
        output.push_str(path.label);
        cursor = start + needle.len();
    }
    output.push_str(&text[cursor..]);
    output
}

/// The set a run redacts with. It is shared with the output filters of the
/// running process, so paths authorized by a later reload are covered too.
#[derive(Debug, Clone, Default)]
pub struct SensitiveSet(Arc<Mutex<Vec<SensitivePath>>>);

impl SensitiveSet {
    pub fn new(paths: Vec<SensitivePath>) -> Self {
        let set = Self::default();
        set.extend(paths);
        set
    }

    pub fn extend(&self, paths: Vec<SensitivePath>) {
        let mut known = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        for path in paths {
            if !known.contains(&path) {
                known.push(path);
            }
        }
    }

    pub fn snapshot(&self) -> Vec<SensitivePath> {
        self.0
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }
}

/// Holds back the part of a stream that may still be the start of a path and
/// releases only text whose paths are complete, so a path split across reads
/// is never stored.
pub struct StreamRedactor {
    known: SensitiveSet,
    held: Vec<u8>,
}

impl StreamRedactor {
    pub fn new(known: SensitiveSet) -> Self {
        Self {
            known,
            held: Vec::new(),
        }
    }

    fn release(&mut self, cut: usize, known: &[SensitivePath]) -> Vec<u8> {
        let rest = self.held.split_off(cut);
        let head = std::mem::replace(&mut self.held, rest);
        redact_text(&String::from_utf8_lossy(&head), known).into_bytes()
    }
}

impl OutputFilter for StreamRedactor {
    fn push(&mut self, chunk: &[u8]) -> Vec<u8> {
        self.held.extend_from_slice(chunk);
        let known = self.known.snapshot();
        match release_point(&self.held, &known) {
            Some(cut) => self.release(cut, &known),
            None => Vec::new(),
        }
    }

    fn finish(&mut self) -> Vec<u8> {
        let known = self.known.snapshot();
        let end = self.held.len();
        self.release(end, &known)
    }
}

/// Up to where held output may be released: after the last line break, or,
/// for a line too long to hold, before any path that could still be cut.
fn release_point(held: &[u8], known: &[SensitivePath]) -> Option<usize> {
    let line_end = held
        .iter()
        .rposition(|byte| *byte == b'\n')
        .map_or(0, |index| index + 1);
    let cut = if held.len() - line_end <= MAX_HELD_BYTES {
        line_end
    } else {
        split_outside_paths(held, known)
    };
    (cut > 0).then_some(cut)
}

fn split_outside_paths(held: &[u8], known: &[SensitivePath]) -> usize {
    let lowered = held.to_ascii_lowercase();
    let keep = known.iter().map(|path| path.text.len()).max().unwrap_or(0);
    let mut cut = held.len().saturating_sub(keep);
    while let Some(start) = first_crossing(&lowered, known, cut) {
        cut = start;
    }
    for _ in 0..3 {
        if cut > 0 && cut < held.len() && (held[cut] & 0xC0) == 0x80 {
            cut -= 1;
        }
    }
    cut
}

/// Start of the earliest path that begins before `cut` and ends after it.
fn first_crossing(lowered: &[u8], known: &[SensitivePath], cut: usize) -> Option<usize> {
    known
        .iter()
        .filter_map(|path| {
            let needle = path.text.to_ascii_lowercase();
            let width = needle.len();
            (cut.saturating_sub(width - 1)..cut).find(|&start| {
                start + width > cut && lowered[start..].starts_with(needle.as_bytes())
            })
        })
        .min()
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    fn paths(certificate: &str, private_key: &str) -> Vec<TlsPaths> {
        vec![TlsPaths {
            certificate: PathBuf::from(certificate),
            private_key: PathBuf::from(private_key),
        }]
    }

    fn known() -> Vec<SensitivePath> {
        sensitive_paths(&paths("/Users/u/certs/cert.pem", "/Users/u/certs/key.pem"))
    }

    #[test]
    fn sensitive_paths_cover_both_files_and_their_shared_directory_once() {
        let listed = known();
        let texts: Vec<&str> = listed.iter().map(|path| path.text.as_str()).collect();

        assert_eq!(
            texts,
            vec![
                "/Users/u/certs/cert.pem",
                "/Users/u/certs",
                "/Users/u/certs/key.pem",
            ]
        );
        assert_eq!(listed[1].label, TLS_DIRECTORY_LABEL);
    }

    #[test]
    fn paths_that_caddy_could_not_receive_are_not_listed() {
        let listed = sensitive_paths(&paths("relative/cert.pem", "/"));

        assert!(listed.is_empty(), "{listed:?}");
    }

    #[test]
    fn a_path_inside_quotes_or_mid_line_is_replaced_every_time_it_appears() {
        let text = "load \"/Users/u/certs/cert.pem\" then /Users/u/certs/cert.pem again";

        assert_eq!(
            redact_text(text, &known()),
            "load \"<证书文件>\" then <证书文件> again"
        );
    }

    #[test]
    fn a_directory_is_replaced_only_where_it_is_not_part_of_a_file_path() {
        let text = "open /Users/u/certs/key.pem and /Users/u/certs/other.pem";

        assert_eq!(
            redact_text(text, &known()),
            "open <私钥文件> and <TLS 目录>/other.pem"
        );
    }

    #[test]
    fn a_longer_path_that_starts_with_a_listed_path_is_replaced_first() {
        let known = sensitive_paths(&paths("/a/key", "/a/key.pem"));

        assert_eq!(
            redact_text("load /a/key.pem and /a/key", &known),
            "load <私钥文件> and <证书文件>"
        );
    }

    #[test]
    fn case_differences_do_not_let_a_path_through() {
        let text = "ERROR /USERS/U/CERTS/KEY.PEM and /users/u/certs/cert.pem";

        assert_eq!(
            redact_text(text, &known()),
            "ERROR <私钥文件> and <证书文件>"
        );
    }

    #[test]
    fn text_without_a_path_is_returned_unchanged() {
        let text = "Error: adapting config: Caddyfile:2: unrecognized directive 中文";

        assert_eq!(redact_text(text, &known()), text);
        assert_eq!(redact_text(text, &[]), text);
    }

    #[test]
    fn a_path_split_across_chunks_is_never_stored_in_part_or_whole() {
        let mut redactor = StreamRedactor::new(SensitiveSet::new(known()));
        let mut stored = Vec::new();
        for chunk in [
            b"tls /Users/u/cer".as_slice(),
            b"ts/cert.pe".as_slice(),
            b"m\nnext line\n".as_slice(),
        ] {
            stored.extend(redactor.push(chunk));
        }
        stored.extend(redactor.finish());

        let text = String::from_utf8(stored).expect("utf8");
        assert_eq!(text, "tls <证书文件>\nnext line\n");
    }

    #[test]
    fn a_held_partial_line_is_released_when_the_stream_ends() {
        let mut redactor = StreamRedactor::new(SensitiveSet::new(known()));

        assert!(
            redactor
                .push(b"no newline /Users/u/certs/key.pem")
                .is_empty()
        );
        let released = String::from_utf8(redactor.finish()).expect("utf8");

        assert_eq!(released, "no newline <私钥文件>");
    }

    #[test]
    fn a_very_long_line_without_breaks_is_released_without_splitting_a_path() {
        let mut redactor = StreamRedactor::new(SensitiveSet::new(known()));
        let padding = "x".repeat(MAX_HELD_BYTES);
        let line = format!("{padding}/Users/u/certs/cert.pem tail");

        let mut stored = redactor.push(line.as_bytes());
        stored.extend(redactor.finish());

        let text = String::from_utf8(stored).expect("utf8");
        assert!(!text.contains("/Users"), "{}", &text[text.len() - 80..]);
        assert!(text.ends_with("<证书文件> tail"));
    }

    #[test]
    fn redaction_that_is_authorized_later_applies_to_later_output() {
        let set = SensitiveSet::new(Vec::new());
        let mut redactor = StreamRedactor::new(set.clone());
        assert_eq!(
            redactor.push(b"first /Users/u/certs/key.pem\n"),
            b"first /Users/u/certs/key.pem\n"
        );

        set.extend(known());
        let later = redactor.push(b"second /Users/u/certs/key.pem\n");

        assert_eq!(later, "second <私钥文件>\n".as_bytes());
    }
}
