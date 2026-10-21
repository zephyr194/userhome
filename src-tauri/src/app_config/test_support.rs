//! In-memory `ConfigFs` for tests. Every operation is recorded, so tests can
//! prove which paths were touched and that no content was read. Symbolic links
//! are resolved per component, like the real file system.

use std::{
    cell::RefCell,
    collections::{BTreeMap, BTreeSet, VecDeque},
    ffi::{OsStr, OsString},
    path::{Component, Path, PathBuf},
};

use super::discover::{ConfigFs, FsError, NodeInfo, NodeKind};

const MAX_LINK_HOPS: usize = 40;

#[derive(Debug, Clone, PartialEq, Eq)]
enum Node {
    Dir,
    File {
        content: Vec<u8>,
        modified_unix_millis: i64,
    },
    Symlink(PathBuf),
    Special,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Op {
    Stat,
    Canonicalize,
    Read,
}

#[derive(Default)]
pub struct FakeFs {
    nodes: BTreeMap<PathBuf, Node>,
    denied: BTreeSet<PathBuf>,
    forbid_reads: bool,
    ops: RefCell<Vec<(Op, PathBuf)>>,
}

impl FakeFs {
    pub fn new() -> Self {
        let mut fs = Self::default();
        fs.nodes.insert(PathBuf::from("/"), Node::Dir);
        fs
    }

    pub fn dir(mut self, path: &str) -> Self {
        self.add_parents(Path::new(path));
        self.nodes.entry(PathBuf::from(path)).or_insert(Node::Dir);
        self
    }

    pub fn file(self, path: &str, content: &str) -> Self {
        self.file_bytes(path, content.as_bytes().to_vec(), 1_700_000_000_000)
    }

    pub fn file_bytes(mut self, path: &str, content: Vec<u8>, modified_unix_millis: i64) -> Self {
        self.add_parents(Path::new(path));
        self.nodes.insert(
            PathBuf::from(path),
            Node::File {
                content,
                modified_unix_millis,
            },
        );
        self
    }

    pub fn symlink(mut self, path: &str, target: &str) -> Self {
        self.add_parents(Path::new(path));
        self.nodes
            .insert(PathBuf::from(path), Node::Symlink(PathBuf::from(target)));
        self
    }

    pub fn special(mut self, path: &str) -> Self {
        self.add_parents(Path::new(path));
        self.nodes.insert(PathBuf::from(path), Node::Special);
        self
    }

    pub fn denied(mut self, path: &str) -> Self {
        self.denied.insert(PathBuf::from(path));
        self
    }

    /// Any read of content panics. Used to prove a path is never opened for reading.
    pub fn forbid_reads(mut self) -> Self {
        self.forbid_reads = true;
        self
    }

    pub fn ops(&self) -> Vec<(Op, PathBuf)> {
        self.ops.borrow().clone()
    }

    fn add_parents(&mut self, path: &Path) {
        for ancestor in path.ancestors().skip(1) {
            self.nodes
                .entry(ancestor.to_path_buf())
                .or_insert(Node::Dir);
        }
    }

    fn record(&self, op: Op, path: &Path) {
        self.ops.borrow_mut().push((op, path.to_path_buf()));
    }

    fn check_denied(&self, path: &Path) -> Result<(), FsError> {
        if self.denied.iter().any(|root| path.starts_with(root)) {
            Err(FsError::PermissionDenied)
        } else {
            Ok(())
        }
    }

    fn resolve(&self, path: &Path) -> Result<PathBuf, FsError> {
        if !path.is_absolute() {
            return Err(FsError::Other);
        }
        let mut pending: VecDeque<OsString> = normal_components(path).collect();
        let mut current = PathBuf::from("/");
        let mut hops = 0;
        while let Some(name) = pending.pop_front() {
            let next = current.join(&name);
            self.check_denied(&next)?;
            match self.nodes.get(&next) {
                None => return Err(FsError::NotFound),
                Some(Node::Symlink(target)) => {
                    hops += 1;
                    if hops > MAX_LINK_HOPS {
                        return Err(FsError::Other);
                    }
                    if target.is_absolute() {
                        current = PathBuf::from("/");
                    }
                    let parts: Vec<OsString> = normal_components(target).collect();
                    for part in parts.into_iter().rev() {
                        pending.push_front(part);
                    }
                }
                Some(Node::Dir) => current = next,
                Some(_) if pending.is_empty() => current = next,
                Some(_) => return Err(FsError::NotFound),
            }
        }
        Ok(current)
    }

    fn node_info(&self, path: &Path) -> Result<NodeInfo, FsError> {
        self.check_denied(path)?;
        let (parent, leaf) = split(path)?;
        let real = self.resolve(parent)?.join(leaf);
        Ok(match self.nodes.get(&real).ok_or(FsError::NotFound)? {
            Node::File {
                content,
                modified_unix_millis,
            } => NodeInfo {
                kind: NodeKind::File,
                size: content.len() as u64,
                modified_unix_millis: *modified_unix_millis,
            },
            Node::Symlink(_) => NodeInfo {
                kind: NodeKind::Symlink,
                size: 0,
                modified_unix_millis: 0,
            },
            Node::Dir | Node::Special => NodeInfo {
                kind: NodeKind::Other,
                size: 0,
                modified_unix_millis: 0,
            },
        })
    }
}

impl ConfigFs for FakeFs {
    fn symlink_metadata(&self, path: &Path) -> Result<NodeInfo, FsError> {
        self.record(Op::Stat, path);
        self.node_info(path)
    }

    fn canonicalize(&self, path: &Path) -> Result<PathBuf, FsError> {
        self.record(Op::Canonicalize, path);
        self.resolve(path)
    }

    fn read_bounded(&self, path: &Path, max_bytes: usize) -> Result<Vec<u8>, FsError> {
        self.record(Op::Read, path);
        assert!(!self.forbid_reads, "content must not be read for this path");
        self.check_denied(path)?;
        let (parent, leaf) = split(path)?;
        let real = self.resolve(parent)?.join(leaf);
        match self.nodes.get(&real) {
            Some(Node::File { content, .. }) if content.len() > max_bytes => Err(FsError::TooLarge),
            Some(Node::File { content, .. }) => Ok(content.clone()),
            Some(_) => Err(FsError::Other),
            None => Err(FsError::NotFound),
        }
    }
}

fn normal_components(path: &Path) -> impl Iterator<Item = OsString> + '_ {
    path.components().filter_map(|component| match component {
        Component::Normal(name) => Some(name.to_os_string()),
        _ => None,
    })
}

fn split(path: &Path) -> Result<(&Path, &OsStr), FsError> {
    match (path.parent(), path.file_name()) {
        (Some(parent), Some(leaf)) => Ok((parent, leaf)),
        _ => Err(FsError::Other),
    }
}
