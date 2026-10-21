//! Bounded reads of authorized resources. The limit is enforced while
//! streaming (`take(max + 1)`), never by trusting a prior `stat`, so a file
//! that grows during the read still cannot be loaded in full. Every read
//! re-resolves the grant, and failures keep their kind instead of collapsing
//! into an empty document.

use std::{
    fs::{self, File},
    io::{self, Read, Seek, SeekFrom},
    os::unix::fs::MetadataExt,
    path::{Path, PathBuf},
};

use sha2::{Digest, Sha256};

use crate::security::paths::is_contained;

use super::{GrantAccess, GrantCoordinator, GrantError, GrantId, GrantKind, GrantRecord, path};

/// Default text resource limit. Callers needing more must pass it explicitly.
pub const DEFAULT_MAX_READ_BYTES: usize = 1024 * 1024;
// Pre-allocation is only a hint; never reserve more than this up front.
const PREALLOCATION_CAP: usize = 8 * 1024 * 1024;

/// Why an authorized resource could not be read. The six named kinds are never
/// merged with each other or with an empty document; `Io` only carries
/// failures that fit none of them, and is the one retryable kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ReadError {
    /// The resource (or its approved root) does not exist.
    NotFound,
    /// The operating system denied access.
    PermissionDenied,
    /// The request or content is not well formed: bad relative path, invalid
    /// UTF-8 text, or a damaged authorization store.
    Malformed,
    /// The content exceeds the read limit.
    TooLarge,
    /// The target is not something this reader supports: a directory, FIFO or
    /// device instead of a regular file, or an authorization store from a
    /// newer version.
    Unsupported,
    /// The authorization no longer covers the resource: it was revoked, or the
    /// target now resolves outside the approved root.
    Excluded,
    /// Any other I/O failure.
    Io,
}

impl From<GrantError> for ReadError {
    fn from(error: GrantError) -> Self {
        match error {
            GrantError::NotFound => Self::NotFound,
            GrantError::PermissionDenied | GrantError::StoreIo => Self::PermissionDenied,
            GrantError::Canonicalize
            | GrantError::InvalidRelativePath
            | GrantError::StoreCorrupt => Self::Malformed,
            GrantError::NotDirectory
            | GrantError::NotFile
            | GrantError::StoreUnsupportedVersion => Self::Unsupported,
            GrantError::SymlinkEscape
            | GrantError::OutsideHome
            | GrantError::ProtectedLocation
            | GrantError::HomeUnavailable
            | GrantError::ReservedPurpose
            | GrantError::UnknownGrant => Self::Excluded,
            GrantError::LimitReached => Self::Io,
        }
    }
}

/// Identity of the content that was read. Later writes compare against it to
/// detect that the file changed or was swapped.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContentFingerprint {
    /// Number of bytes actually read.
    pub size: u64,
    /// Modification time (Unix epoch nanoseconds) observed before reading.
    pub modified_unix_nanos: i128,
    pub device: u64,
    pub inode: u64,
    /// Lowercase hex SHA-256 of the bytes read.
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GrantedRead {
    pub content: Vec<u8>,
    pub fingerprint: ContentFingerprint,
}

impl GrantedRead {
    /// The content as UTF-8 text; invalid text is `Malformed`, not empty.
    pub fn text(&self) -> Result<&str, ReadError> {
        std::str::from_utf8(&self.content).map_err(|_| ReadError::Malformed)
    }
}

/// Where a bounded range read of a file grant begins.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RangeStart {
    /// The last `max_bytes` bytes (the whole file when it is shorter).
    Tail,
    /// Continues from this byte offset. When more than `max_bytes` were added
    /// since, only the last `max_bytes` are returned and the passed-over bytes
    /// are reported as `skipped`. An offset past the end yields nothing.
    Since(u64),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GrantedRange {
    pub content: Vec<u8>,
    /// File offset of `content[0]`.
    pub start: u64,
    /// Bytes between the requested offset and `start`; zero for a tail read.
    pub skipped: u64,
    /// File size observed when the file was opened.
    pub file_size: u64,
    pub device: u64,
    pub inode: u64,
}

impl GrantCoordinator {
    /// Reads at most `max_bytes` from a file grant's range, never the whole file
    /// unless it is shorter than the limit. Only file grants are accepted.
    pub fn read_resource_range(
        &self,
        id: &GrantId,
        start: RangeStart,
        max_bytes: usize,
    ) -> Result<GrantedRange, ReadError> {
        let record = self.resolve_with(id, GrantAccess::General)?;
        if record.kind != GrantKind::File {
            return Err(ReadError::Unsupported);
        }
        let target = record.target_path();
        if !fs::metadata(&target).map_err(io_error)?.is_file() {
            return Err(ReadError::Unsupported);
        }
        let mut file = File::open(&target).map_err(io_error)?;
        let opened = file.metadata().map_err(io_error)?;
        if !opened.is_file() {
            return Err(ReadError::Unsupported);
        }
        ensure_still_authorized(&record, &target, &opened)?;
        range_read(&mut file, &opened, start, max_bytes)
    }
}

fn range_read(
    file: &mut File,
    metadata: &fs::Metadata,
    start: RangeStart,
    max_bytes: usize,
) -> Result<GrantedRange, ReadError> {
    let size = metadata.len();
    let max = max_bytes as u64;
    let (begin, skipped) = match start {
        RangeStart::Tail => (size.saturating_sub(max), 0),
        RangeStart::Since(offset) if offset > size => (size, 0),
        RangeStart::Since(offset) if size - offset > max => {
            let begin = size - max;
            (begin, begin - offset)
        }
        RangeStart::Since(offset) => (offset, 0),
    };
    let wanted = (size - begin).min(max);
    file.seek(SeekFrom::Start(begin)).map_err(io_error)?;
    let mut content = Vec::with_capacity(
        usize::try_from(wanted)
            .unwrap_or(usize::MAX)
            .min(PREALLOCATION_CAP),
    );
    Read::take(file.by_ref(), wanted)
        .read_to_end(&mut content)
        .map_err(io_error)?;
    Ok(GrantedRange {
        content,
        start: begin,
        skipped,
        file_size: size,
        device: metadata.dev(),
        inode: metadata.ino(),
    })
}

impl GrantCoordinator {
    /// Reads with the default 1 MiB limit.
    pub fn read_resource(
        &self,
        id: &GrantId,
        relative: Option<&str>,
    ) -> Result<GrantedRead, ReadError> {
        self.read_resource_with_limit(id, relative, DEFAULT_MAX_READ_BYTES)
    }

    /// Re-resolves the grant, then reads at most `max_bytes` of the target: a
    /// file grant reads its file (`relative` must be `None`), a directory grant
    /// reads the file at `relative` below its root.
    pub fn read_resource_with_limit(
        &self,
        id: &GrantId,
        relative: Option<&str>,
        max_bytes: usize,
    ) -> Result<GrantedRead, ReadError> {
        self.read_with_access(id, relative, max_bytes, GrantAccess::General)
    }

    /// The read of the dedicated shell startup editor: only a shell startup
    /// file grant is read, anything else is `Excluded`.
    pub fn read_shell_startup_with_limit(
        &self,
        id: &GrantId,
        relative: Option<&str>,
        max_bytes: usize,
    ) -> Result<GrantedRead, ReadError> {
        self.read_with_access(id, relative, max_bytes, GrantAccess::ShellStartup)
    }

    pub(super) fn read_with_access(
        &self,
        id: &GrantId,
        relative: Option<&str>,
        max_bytes: usize,
        access: GrantAccess,
    ) -> Result<GrantedRead, ReadError> {
        let record = self.resolve_with(id, access)?;
        let target = match (record.kind, relative) {
            (GrantKind::File, None) => record.target_path(),
            (GrantKind::File, Some(_)) => return Err(GrantError::InvalidRelativePath.into()),
            (GrantKind::Directory, Some(relative)) => {
                path::resolve_within(&record.path, relative, self.home.as_deref())?
            }
            // A directory is not a readable resource by itself.
            (GrantKind::Directory, None) => return Err(ReadError::Unsupported),
        };
        read_target(&record, &target, max_bytes)
    }
}

/// Why a built-in source was not read.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BuiltInReadError {
    /// The target resolves outside `$HOME` or into a protected credential
    /// location; it was not opened.
    Outside,
    Failed(ReadError),
}

/// Bounded read of a source UserHome itself names (a fixed file below the
/// user's home), as opposed to one the user authorized. It applies the same
/// `$HOME` rule as grants (`path::ensure_below_home`: strictly below the home
/// directory, outside `~/.ssh`, `~/.gnupg` and `~/Library/Keychains`) to the
/// canonical target, so a symbolic link that leads out of `$HOME` is reported
/// as `Outside` and never opened. The limit is enforced while streaming.
pub fn read_built_in(
    path: &Path,
    home: Option<&Path>,
    max_bytes: usize,
) -> Result<GrantedRead, BuiltInReadError> {
    let failed = |error: io::Error| BuiltInReadError::Failed(io_error(error));
    let canonical = fs::canonicalize(path).map_err(failed)?;
    path::ensure_below_home(&canonical, home).map_err(|error| match error {
        GrantError::OutsideHome | GrantError::ProtectedLocation => BuiltInReadError::Outside,
        other => BuiltInReadError::Failed(other.into()),
    })?;
    if !fs::metadata(&canonical).map_err(failed)?.is_file() {
        return Err(BuiltInReadError::Failed(ReadError::Unsupported));
    }
    let file = File::open(&canonical).map_err(failed)?;
    let metadata = file.metadata().map_err(failed)?;
    if !metadata.is_file() {
        return Err(BuiltInReadError::Failed(ReadError::Unsupported));
    }
    // The path must still name the file that was opened (no swap in between).
    if fs::canonicalize(&canonical).map_err(failed)? != canonical {
        return Err(BuiltInReadError::Outside);
    }
    ensure_same_file(&canonical, &metadata).map_err(BuiltInReadError::Failed)?;
    granted_read(&file, &metadata, max_bytes).map_err(BuiltInReadError::Failed)
}

/// Whether `canonical` (already resolved) is a built-in location the `$HOME`
/// rule allows: strictly below the home directory and outside the protected
/// credential locations. Never touches the file system.
pub fn is_below_home(canonical: &Path, home: Option<&Path>) -> bool {
    path::ensure_below_home(canonical, home).is_ok()
}

/// Resolves a fixed built-in directory under `$HOME` for listing. The canonical
/// directory must pass the same `$HOME` rule as `read_built_in`, so a symbolic
/// link that leads out of `$HOME` is reported as `Outside` and never listed.
pub fn built_in_dir(path: &Path, home: Option<&Path>) -> Result<PathBuf, BuiltInReadError> {
    let failed = |error: io::Error| BuiltInReadError::Failed(io_error(error));
    let canonical = fs::canonicalize(path).map_err(failed)?;
    path::ensure_below_home(&canonical, home).map_err(|error| match error {
        GrantError::OutsideHome | GrantError::ProtectedLocation => BuiltInReadError::Outside,
        other => BuiltInReadError::Failed(other.into()),
    })?;
    if !fs::metadata(&canonical).map_err(failed)?.is_dir() {
        return Err(BuiltInReadError::Failed(ReadError::Unsupported));
    }
    Ok(canonical)
}

fn read_target(
    record: &GrantRecord,
    target: &Path,
    max_bytes: usize,
) -> Result<GrantedRead, ReadError> {
    // Opening a FIFO or device would block or misbehave, so only regular files
    // are ever opened.
    if !fs::metadata(target).map_err(io_error)?.is_file() {
        return Err(ReadError::Unsupported);
    }
    let file = File::open(target).map_err(io_error)?;
    let metadata = file.metadata().map_err(io_error)?;
    if !metadata.is_file() {
        return Err(ReadError::Unsupported);
    }
    ensure_still_authorized(record, target, &metadata)?;
    granted_read(&file, &metadata, max_bytes)
}

fn granted_read(
    file: &File,
    metadata: &fs::Metadata,
    max_bytes: usize,
) -> Result<GrantedRead, ReadError> {
    let content = read_bounded(file, max_bytes, metadata.len())?;
    let fingerprint = ContentFingerprint {
        size: content.len() as u64,
        modified_unix_nanos: i128::from(metadata.mtime()) * 1_000_000_000
            + i128::from(metadata.mtime_nsec()),
        device: metadata.dev(),
        inode: metadata.ino(),
        sha256: format!("{:x}", Sha256::digest(&content)),
    };
    Ok(GrantedRead {
        content,
        fingerprint,
    })
}

/// Closes the window between resolving the path and opening it: the path must
/// still resolve inside the grant and must still name the file that was opened.
fn ensure_still_authorized(
    record: &GrantRecord,
    target: &Path,
    opened: &fs::Metadata,
) -> Result<(), ReadError> {
    let current = fs::canonicalize(target).map_err(io_error)?;
    let inside = match record.kind {
        GrantKind::File => current == record.target_path(),
        GrantKind::Directory => is_contained(&current, &record.path),
    };
    if !inside {
        return Err(ReadError::Excluded);
    }
    ensure_same_file(&current, opened)
}

fn ensure_same_file(current: &Path, opened: &fs::Metadata) -> Result<(), ReadError> {
    let named = fs::metadata(current).map_err(io_error)?;
    if named.dev() != opened.dev() || named.ino() != opened.ino() {
        return Err(ReadError::Excluded);
    }
    Ok(())
}

/// Reads at most `max_bytes` from `reader`. One extra byte is requested so an
/// over-limit source is detected without ever buffering more than `max + 1`.
fn read_bounded<R: Read>(
    reader: R,
    max_bytes: usize,
    size_hint: u64,
) -> Result<Vec<u8>, ReadError> {
    let limit = (max_bytes as u64).saturating_add(1);
    let capacity = usize::try_from(size_hint)
        .unwrap_or(usize::MAX)
        .min(max_bytes)
        .min(PREALLOCATION_CAP);
    let mut content = Vec::with_capacity(capacity);
    reader
        .take(limit)
        .read_to_end(&mut content)
        .map_err(io_error)?;
    if content.len() > max_bytes {
        return Err(ReadError::TooLarge);
    }
    Ok(content)
}

fn io_error(error: io::Error) -> ReadError {
    match error.kind() {
        io::ErrorKind::NotFound | io::ErrorKind::NotADirectory => ReadError::NotFound,
        io::ErrorKind::PermissionDenied => ReadError::PermissionDenied,
        _ => ReadError::Io,
    }
}

#[cfg(test)]
mod tests {
    use std::{
        cell::Cell,
        collections::HashSet,
        fs,
        io::{self, Read},
        os::unix::fs::{MetadataExt, PermissionsExt, symlink},
        path::PathBuf,
        process::Command,
        rc::Rc,
    };

    use uuid::Uuid;

    use super::{
        super::{GrantCoordinator, GrantPurpose, GrantStore},
        BuiltInReadError, DEFAULT_MAX_READ_BYTES, RangeStart, ReadError, built_in_dir,
        is_below_home, read_bounded, read_built_in,
    };

    struct Fixture {
        root: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let root = fs::canonicalize(std::env::temp_dir())
                .expect("canonical temp dir")
                .join(format!("userhome-grant-read-{}", Uuid::new_v4()));
            fs::create_dir_all(&root).expect("create fixture root");
            Self { root }
        }

        fn coordinator(&self) -> GrantCoordinator {
            GrantCoordinator::new(
                GrantStore::new(self.root.join("support")),
                Some(self.root.clone()),
            )
        }

        fn directory(&self, name: &str) -> PathBuf {
            let path = self.root.join(name);
            fs::create_dir_all(&path).expect("create directory");
            path
        }

        fn file(&self, name: &str, contents: &[u8]) -> PathBuf {
            let path = self.root.join(name);
            fs::write(&path, contents).expect("write file");
            path
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            if let Ok(entries) = fs::read_dir(&self.root) {
                for entry in entries.flatten() {
                    let _ = fs::set_permissions(entry.path(), fs::Permissions::from_mode(0o700));
                }
            }
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    /// Serves bytes forever and counts how many it handed out.
    struct EndlessReader {
        served: Rc<Cell<u64>>,
        chunk: usize,
    }

    impl Read for EndlessReader {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            let length = buf.len().min(self.chunk);
            buf[..length].fill(b'x');
            self.served.set(self.served.get() + length as u64);
            Ok(length)
        }
    }

    #[test]
    fn reads_a_file_grant_with_a_fingerprint() {
        let fixture = Fixture::new();
        let file = fixture.file("settings.json", b"hello");
        let coordinator = fixture.coordinator();
        let grant = coordinator
            .create(GrantPurpose::ConfigFile, &file)
            .expect("create grant");

        let read = coordinator
            .read_resource(&grant.id, None)
            .expect("read granted file");

        let metadata = fs::metadata(&file).expect("file metadata");
        assert_eq!(read.content, b"hello");
        assert_eq!(read.text(), Ok("hello"));
        assert_eq!(read.fingerprint.size, 5);
        assert_eq!(
            read.fingerprint.sha256,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
        assert_eq!(read.fingerprint.device, metadata.dev());
        assert_eq!(read.fingerprint.inode, metadata.ino());
        assert_eq!(
            read.fingerprint.modified_unix_nanos,
            i128::from(metadata.mtime()) * 1_000_000_000 + i128::from(metadata.mtime_nsec())
        );
    }

    #[test]
    fn reads_a_child_below_a_directory_grant_and_follows_in_bounds_symlinks() {
        let fixture = Fixture::new();
        let directory = fixture.directory("project");
        fs::write(directory.join("real.toml"), b"a = 1\n").expect("write child");
        symlink("real.toml", directory.join("link.toml")).expect("create symlink");
        let coordinator = fixture.coordinator();
        let grant = coordinator
            .create(GrantPurpose::ConfigDirectory, &directory)
            .expect("create grant");

        let direct = coordinator
            .read_resource(&grant.id, Some("real.toml"))
            .expect("read child");
        let linked = coordinator
            .read_resource(&grant.id, Some("link.toml"))
            .expect("read in-bounds symlink");

        assert_eq!(direct.content, b"a = 1\n");
        assert_eq!(linked, direct);
    }

    #[test]
    fn a_file_exactly_at_the_limit_is_read_and_one_byte_more_is_too_large() {
        let fixture = Fixture::new();
        let file = fixture.file("edge.txt", &[b'a'; 16]);
        let coordinator = fixture.coordinator();
        let grant = coordinator
            .create(GrantPurpose::ConfigFile, &file)
            .expect("create grant");

        let exact = coordinator
            .read_resource_with_limit(&grant.id, None, 16)
            .expect("read exactly at the limit");
        let over = coordinator.read_resource_with_limit(&grant.id, None, 15);

        assert_eq!(exact.fingerprint.size, 16);
        assert_eq!(over, Err(ReadError::TooLarge));
    }

    #[test]
    fn the_default_limit_is_one_mebibyte_and_a_higher_limit_can_be_requested() {
        let fixture = Fixture::new();
        let file = fixture.file("big.txt", &[]);
        fs::File::options()
            .write(true)
            .open(&file)
            .and_then(|handle| handle.set_len(DEFAULT_MAX_READ_BYTES as u64 + 1))
            .expect("grow file");
        let coordinator = fixture.coordinator();
        let grant = coordinator
            .create(GrantPurpose::ConfigFile, &file)
            .expect("create grant");

        let default_read = coordinator.read_resource(&grant.id, None);
        let raised = coordinator
            .read_resource_with_limit(&grant.id, None, DEFAULT_MAX_READ_BYTES * 2)
            .expect("read with a higher limit");

        assert_eq!(DEFAULT_MAX_READ_BYTES, 1024 * 1024);
        assert_eq!(default_read, Err(ReadError::TooLarge));
        assert_eq!(raised.fingerprint.size, DEFAULT_MAX_READ_BYTES as u64 + 1);
    }

    #[test]
    fn a_source_that_keeps_growing_is_never_read_past_the_limit_plus_one() {
        let served = Rc::new(Cell::new(0));
        let reader = EndlessReader {
            served: Rc::clone(&served),
            chunk: 7,
        };

        // The size hint is stale: the file looked small when it was statted.
        let result = read_bounded(reader, 1000, 10);

        assert_eq!(result, Err(ReadError::TooLarge));
        assert_eq!(served.get(), 1001);
    }

    #[test]
    fn a_source_at_exactly_the_limit_is_accepted_and_reads_stop_there() {
        let served = Rc::new(Cell::new(0));
        let reader = EndlessReader {
            served: Rc::clone(&served),
            chunk: 64,
        }
        .take(1000);

        let content = read_bounded(reader, 1000, 1000).expect("read exactly the limit");

        assert_eq!(content.len(), 1000);
        assert!(served.get() <= 1000);
    }

    #[test]
    fn a_revoked_grant_can_no_longer_read() {
        let fixture = Fixture::new();
        let file = fixture.file("settings.json", b"{}");
        let coordinator = fixture.coordinator();
        let grant = coordinator
            .create(GrantPurpose::ConfigFile, &file)
            .expect("create grant");
        assert!(coordinator.read_resource(&grant.id, None).is_ok());

        coordinator.revoke(&grant.id).expect("revoke grant");

        assert_eq!(
            coordinator.read_resource(&grant.id, None),
            Err(ReadError::Excluded)
        );
    }

    #[test]
    fn a_file_grant_replaced_by_a_symlink_to_an_outside_target_fails() {
        let fixture = Fixture::new();
        let file = fixture.file("settings.json", b"granted");
        let outside = fixture.file("outside.json", b"secret");
        let coordinator = fixture.coordinator();
        let grant = coordinator
            .create(GrantPurpose::ConfigFile, &file)
            .expect("create grant");

        fs::remove_file(&file).expect("remove granted file");
        symlink(&outside, &file).expect("swap in a symlink");

        assert_eq!(
            coordinator.read_resource(&grant.id, None),
            Err(ReadError::Excluded)
        );
    }

    #[test]
    fn a_directory_child_replaced_by_an_escaping_symlink_fails() {
        let fixture = Fixture::new();
        let directory = fixture.directory("project");
        fs::write(directory.join("config.json"), b"granted").expect("write child");
        let outside = fixture.file("outside.json", b"secret");
        let coordinator = fixture.coordinator();
        let grant = coordinator
            .create(GrantPurpose::ConfigDirectory, &directory)
            .expect("create grant");
        assert!(
            coordinator
                .read_resource(&grant.id, Some("config.json"))
                .is_ok()
        );

        fs::remove_file(directory.join("config.json")).expect("remove child");
        symlink(&outside, directory.join("config.json")).expect("swap in a symlink");

        assert_eq!(
            coordinator.read_resource(&grant.id, Some("config.json")),
            Err(ReadError::Excluded)
        );
    }

    #[test]
    fn a_directory_grant_root_replaced_by_a_symlink_fails() {
        let fixture = Fixture::new();
        let directory = fixture.directory("project");
        fs::write(directory.join("config.json"), b"granted").expect("write child");
        let elsewhere = fixture.directory("elsewhere");
        fs::write(elsewhere.join("config.json"), b"other").expect("write other child");
        let coordinator = fixture.coordinator();
        let grant = coordinator
            .create(GrantPurpose::ConfigDirectory, &directory)
            .expect("create grant");

        fs::remove_dir_all(&directory).expect("remove root");
        symlink(&elsewhere, &directory).expect("swap in a symlink");

        assert_eq!(
            coordinator.read_resource(&grant.id, Some("config.json")),
            Err(ReadError::Excluded)
        );
    }

    #[test]
    fn unsafe_relative_paths_are_malformed_and_never_reach_the_file_system() {
        let fixture = Fixture::new();
        let directory = fixture.directory("project");
        fixture.file("outside.json", b"secret");
        let file = fixture.file("settings.json", b"{}");
        let coordinator = fixture.coordinator();
        let dir_grant = coordinator
            .create(GrantPurpose::ConfigDirectory, &directory)
            .expect("create directory grant");
        let file_grant = coordinator
            .create(GrantPurpose::ConfigFile, &file)
            .expect("create file grant");

        for relative in ["../outside.json", "/etc/hosts", "", "a\\b"] {
            assert_eq!(
                coordinator.read_resource(&dir_grant.id, Some(relative)),
                Err(ReadError::Malformed),
                "relative path {relative:?}"
            );
        }
        assert_eq!(
            coordinator.read_resource(&file_grant.id, Some("x")),
            Err(ReadError::Malformed)
        );
    }

    #[test]
    fn invalid_utf8_is_malformed_text_rather_than_an_empty_document() {
        let fixture = Fixture::new();
        let file = fixture.file("binary.json", &[0xff, 0xfe, 0x00]);
        let coordinator = fixture.coordinator();
        let grant = coordinator
            .create(GrantPurpose::ConfigFile, &file)
            .expect("create grant");

        let read = coordinator
            .read_resource(&grant.id, None)
            .expect("bytes are readable");

        assert_eq!(read.text(), Err(ReadError::Malformed));
    }

    #[test]
    fn the_six_failure_kinds_are_distinct() {
        let fixture = Fixture::new();
        let directory = fixture.directory("project");
        fs::create_dir_all(directory.join("subdir")).expect("create subdirectory");
        fs::write(directory.join("big.txt"), [b'a'; 32]).expect("write big file");
        let fifo = directory.join("pipe");
        assert!(
            Command::new("mkfifo")
                .arg(&fifo)
                .status()
                .expect("run mkfifo")
                .success()
        );
        let locked = fixture.file("locked.json", b"{}");
        let revoked_file = fixture.file("revoked.json", b"{}");
        let coordinator = fixture.coordinator();
        let dir_grant = coordinator
            .create(GrantPurpose::ConfigDirectory, &directory)
            .expect("create directory grant");
        let locked_grant = coordinator
            .create(GrantPurpose::ConfigFile, &locked)
            .expect("create locked grant");
        let revoked_grant = coordinator
            .create(GrantPurpose::ConfigFile, &revoked_file)
            .expect("create revoked grant");
        coordinator.revoke(&revoked_grant.id).expect("revoke grant");

        let mut outcomes = vec![
            (
                ReadError::NotFound,
                coordinator.read_resource(&dir_grant.id, Some("missing.json")),
            ),
            (
                ReadError::Malformed,
                coordinator.read_resource(&dir_grant.id, Some("../x")),
            ),
            (
                ReadError::TooLarge,
                coordinator.read_resource_with_limit(&dir_grant.id, Some("big.txt"), 31),
            ),
            (
                ReadError::Unsupported,
                coordinator.read_resource(&dir_grant.id, Some("subdir")),
            ),
            (
                ReadError::Unsupported,
                coordinator.read_resource(&dir_grant.id, Some("pipe")),
            ),
            (
                ReadError::Unsupported,
                coordinator.read_resource(&dir_grant.id, None),
            ),
            (
                ReadError::Excluded,
                coordinator.read_resource(&revoked_grant.id, None),
            ),
        ];
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).expect("lock file");
        if fs::File::open(&locked).is_err() {
            // Skipped when running as a user that bypasses file modes.
            outcomes.push((
                ReadError::PermissionDenied,
                coordinator.read_resource(&locked_grant.id, None),
            ));
        }

        let mut seen = HashSet::new();
        for (expected, outcome) in outcomes {
            assert_eq!(outcome, Err(expected));
            seen.insert(expected);
        }
        assert!(seen.len() >= 5, "kinds seen: {seen:?}");
        if fs::File::open(&locked).is_err() {
            assert_eq!(seen.len(), 6);
        }
    }

    #[test]
    fn a_removed_file_grant_target_is_not_found() {
        let fixture = Fixture::new();
        let file = fixture.file("settings.json", b"{}");
        let coordinator = fixture.coordinator();
        let grant = coordinator
            .create(GrantPurpose::ConfigFile, &file)
            .expect("create grant");

        fs::remove_file(&file).expect("remove file");

        assert_eq!(
            coordinator.read_resource(&grant.id, None),
            Err(ReadError::NotFound)
        );
    }
    // ---- built-in sources ------------------------------------------------

    #[test]
    fn a_tail_range_reads_only_the_last_bytes_within_the_limit() {
        let fixture = Fixture::new();
        let file = fixture.file("job.log", b"0123456789");
        let coordinator = fixture.coordinator();
        let grant = coordinator
            .create(GrantPurpose::ConfigFile, &file)
            .expect("create grant");

        let tail = coordinator
            .read_resource_range(&grant.id, RangeStart::Tail, 4)
            .expect("tail range");
        assert_eq!(tail.content, b"6789");
        assert_eq!(tail.start, 6);
        assert_eq!(tail.skipped, 0);
        assert_eq!(tail.file_size, 10);

        let whole = coordinator
            .read_resource_range(&grant.id, RangeStart::Tail, 100)
            .expect("short file");
        assert_eq!(whole.content, b"0123456789");
        assert_eq!(whole.start, 0);
    }

    #[test]
    fn a_since_range_returns_appended_bytes_and_reports_a_skipped_backlog() {
        let fixture = Fixture::new();
        let file = fixture.file("job.log", b"abc");
        let coordinator = fixture.coordinator();
        let grant = coordinator
            .create(GrantPurpose::ConfigFile, &file)
            .expect("create grant");
        fs::write(&file, b"abcdefghij").expect("append");

        let backlog = coordinator
            .read_resource_range(&grant.id, RangeStart::Since(3), 4)
            .expect("backlog range");
        assert_eq!(backlog.content, b"ghij");
        assert_eq!(backlog.start, 6);
        assert_eq!(backlog.skipped, 3);

        let small = coordinator
            .read_resource_range(&grant.id, RangeStart::Since(8), 4)
            .expect("small append");
        assert_eq!(small.content, b"ij");
        assert_eq!(small.start, 8);
        assert_eq!(small.skipped, 0);
    }

    #[test]
    fn a_since_offset_past_the_end_is_empty_and_reports_the_smaller_size() {
        let fixture = Fixture::new();
        let file = fixture.file("job.log", b"abc");
        let coordinator = fixture.coordinator();
        let grant = coordinator
            .create(GrantPurpose::ConfigFile, &file)
            .expect("create grant");

        let past = coordinator
            .read_resource_range(&grant.id, RangeStart::Since(10), 4)
            .expect("past end");
        assert!(past.content.is_empty());
        assert_eq!(past.start, 3);
        assert_eq!(past.skipped, 0);
        assert_eq!(past.file_size, 3);
    }

    #[test]
    fn a_range_read_refuses_directories_fifos_and_escaping_links() {
        let fixture = Fixture::new();
        let coordinator = fixture.coordinator();

        let directory = fixture.directory("logs");
        let directory_grant = coordinator
            .create(GrantPurpose::ConfigDirectory, &directory)
            .expect("directory grant");
        assert_eq!(
            coordinator
                .read_resource_range(&directory_grant.id, RangeStart::Tail, 4)
                .unwrap_err(),
            ReadError::Unsupported
        );

        let file = fixture.file("fifo.log", b"data");
        let grant = coordinator
            .create(GrantPurpose::ConfigFile, &file)
            .expect("file grant");
        fs::remove_file(&file).expect("remove regular file");
        assert!(
            Command::new("/usr/bin/mkfifo")
                .arg(&file)
                .status()
                .expect("run mkfifo")
                .success()
        );
        assert_eq!(
            coordinator
                .read_resource_range(&grant.id, RangeStart::Tail, 4)
                .unwrap_err(),
            ReadError::Unsupported
        );

        let outside = fixture.file("outside.log", b"secret");
        let linked = fixture.file("linked.log", b"inside");
        let linked_grant = coordinator
            .create(GrantPurpose::ConfigFile, &linked)
            .expect("linked grant");
        fs::remove_file(&linked).expect("remove granted file");
        symlink(&outside, &linked).expect("replace with escaping link");
        assert_eq!(
            coordinator
                .read_resource_range(&linked_grant.id, RangeStart::Tail, 4)
                .unwrap_err(),
            ReadError::Excluded
        );
    }

    #[test]
    fn a_revoked_range_grant_can_no_longer_read() {
        let fixture = Fixture::new();
        let file = fixture.file("job.log", b"abc");
        let coordinator = fixture.coordinator();
        let grant = coordinator
            .create(GrantPurpose::ConfigFile, &file)
            .expect("create grant");
        coordinator.revoke(&grant.id).expect("revoke");

        assert_eq!(
            coordinator
                .read_resource_range(&grant.id, RangeStart::Tail, 4)
                .unwrap_err(),
            ReadError::Excluded
        );
    }

    #[test]
    fn a_built_in_read_stays_below_home_and_keeps_failure_kinds() {
        let fixture = Fixture::new();
        let home = fixture.directory("home");
        let outside = fixture.directory("elsewhere");
        fs::write(outside.join("secret"), b"x").expect("write outside file");
        fs::write(home.join(".zshrc"), b"export A=1\n").expect("write file");
        symlink(outside.join("secret"), home.join("escape")).expect("outside link");
        symlink(".zshrc", home.join("inside")).expect("inside link");
        fs::create_dir_all(home.join(".ssh")).expect("create .ssh");
        fs::write(home.join(".ssh/config"), b"Host *\n").expect("write ssh file");
        symlink(".ssh/config", home.join("ssh-link")).expect("ssh link");
        fs::create_dir_all(home.join("dir")).expect("create directory");
        fs::write(home.join("big"), vec![b'x'; 11]).expect("write big");
        symlink("missing", home.join("dangling")).expect("dangling link");

        let read = |name: &str, max: usize| read_built_in(&home.join(name), Some(&home), max);

        let plain = read(".zshrc", 64).expect("plain file");
        assert_eq!(plain.content, b"export A=1\n");
        assert_eq!(plain.fingerprint.size, 11);
        assert_eq!(
            read("inside", 64).expect("link inside home").content,
            plain.content
        );
        assert_eq!(read("escape", 64), Err(BuiltInReadError::Outside));
        assert_eq!(read("ssh-link", 64), Err(BuiltInReadError::Outside));
        assert_eq!(
            read("absent", 64),
            Err(BuiltInReadError::Failed(ReadError::NotFound))
        );
        assert_eq!(
            read("dangling", 64),
            Err(BuiltInReadError::Failed(ReadError::NotFound))
        );
        assert_eq!(
            read("dir", 64),
            Err(BuiltInReadError::Failed(ReadError::Unsupported))
        );
        assert_eq!(
            read("big", 10),
            Err(BuiltInReadError::Failed(ReadError::TooLarge))
        );
        assert!(read("big", 11).is_ok());
    }

    #[test]
    fn a_built_in_read_fails_closed_without_a_usable_home() {
        let fixture = Fixture::new();
        let home = fixture.directory("home");
        fs::write(home.join(".zshrc"), b"x").expect("write file");

        for unusable in [
            None,
            Some(PathBuf::from("relative")),
            Some(PathBuf::from("/")),
        ] {
            assert_eq!(
                read_built_in(&home.join(".zshrc"), unusable.as_deref(), 64),
                Err(BuiltInReadError::Failed(ReadError::Excluded)),
                "{unusable:?}"
            );
        }
        // `$HOME` itself is not a readable target.
        assert_eq!(
            read_built_in(&home, Some(&home), 64),
            Err(BuiltInReadError::Outside)
        );
    }

    #[test]
    fn a_built_in_read_reports_invalid_text_and_denied_access() {
        let fixture = Fixture::new();
        let home = fixture.directory("home");
        fs::write(home.join("binary"), [0xff, 0xfe]).expect("write bytes");
        let locked = home.join("locked");
        fs::write(&locked, b"x").expect("write locked");
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o000)).expect("lock file");

        let binary = read_built_in(&home.join("binary"), Some(&home), 64).expect("bytes read");
        assert_eq!(binary.text(), Err(ReadError::Malformed));
        if fs::File::open(&locked).is_err() {
            assert_eq!(
                read_built_in(&locked, Some(&home), 64),
                Err(BuiltInReadError::Failed(ReadError::PermissionDenied))
            );
        }
    }

    #[test]
    fn a_built_in_directory_must_resolve_strictly_below_home() {
        let fixture = Fixture::new();
        let home = fixture.directory("home");
        let agents = home.join("Library/LaunchAgents");
        fs::create_dir_all(&agents).expect("create agents");
        let outside = fixture.directory("outside");
        let escape = home.join("Library/Escape");
        symlink(&outside, &escape).expect("link out of home");
        fs::write(home.join("file"), b"x").expect("write file");

        assert_eq!(built_in_dir(&agents, Some(&home)), Ok(agents.clone()));
        assert_eq!(
            built_in_dir(&escape, Some(&home)),
            Err(BuiltInReadError::Outside)
        );
        assert_eq!(
            built_in_dir(&home, Some(&home)),
            Err(BuiltInReadError::Outside)
        );
        assert_eq!(
            built_in_dir(&home.join("file"), Some(&home)),
            Err(BuiltInReadError::Failed(ReadError::Unsupported))
        );
        assert_eq!(
            built_in_dir(&home.join("missing"), Some(&home)),
            Err(BuiltInReadError::Failed(ReadError::NotFound))
        );
        assert!(is_below_home(&agents, Some(&home)));
        assert!(!is_below_home(&outside, Some(&home)));
        assert!(!is_below_home(&agents, None));
    }
}
