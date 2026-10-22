//! Opens a generated Claude Code command in Terminal so the user can read it and
//! run it there. The command goes into a private `.command` script that prints
//! it and waits for Enter. UserHome never reads Terminal output and never sends
//! keystrokes, and it runs nothing itself: only `/usr/bin/open` is launched.

use std::{
    ffi::OsStr,
    fs::{self, DirBuilder, Metadata, OpenOptions},
    io::{self, Write},
    os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

use uuid::Uuid;

use crate::{
    environment::zsh_block::{check_value, quote},
    error::AppError,
    process::{ProcessError, run_bounded},
};

pub const TERMINAL_DIRECTORY: &str = "ai-terminal";
const SCRIPT_PREFIX: &str = "ai-command-";
const SCRIPT_SUFFIX: &str = ".command";
const DIRECTORY_MODE: u32 = 0o700;
const SCRIPT_MODE: u32 = 0o700;
const PERMISSION_BITS: u32 = 0o777;
const OPEN_PROGRAM: &str = "/usr/bin/open";
const OPEN_TIMEOUT: Duration = Duration::from_secs(5);
const OPEN_OUTPUT_BYTES: usize = 4096;
pub const MAX_SCRIPT_AGE: Duration = Duration::from_secs(24 * 60 * 60);

pub trait Launcher {
    fn run(&self, program: &Path, arguments: &[&str]) -> Result<(), ProcessError>;
}

pub struct SystemLauncher;

impl Launcher for SystemLauncher {
    fn run(&self, program: &Path, arguments: &[&str]) -> Result<(), ProcessError> {
        run_bounded(program, arguments, OPEN_TIMEOUT, OPEN_OUTPUT_BYTES).map(|_| ())
    }
}

pub fn open_arguments(script: &str) -> [&str; 3] {
    ["-a", "Terminal", script]
}

pub struct TerminalPlan<'a> {
    pub command: &'a str,
    pub work_dir: Option<&'a Path>,
    pub placeholders: &'a [String],
}

/// The script body. Only quoted literals and the fixed template text reach the
/// shell; the command is also printed once so the user sees exactly what runs.
pub fn script_text(command: &str, work_dir: Option<&str>) -> String {
    let directory = work_dir.map_or_else(|| "\"$HOME\"".to_owned(), quote);
    format!(
        "#!/bin/zsh\ncd -- {directory} || {{ rm -- \"$0\"; exit 1; }}\nprintf '%s\\n' '将运行的命令：'\nprintf '%s\\n' {}\nread -r \"?按回车运行，Ctrl-C 取消：\"\nrm -- \"$0\"\n{command}\n",
        quote(command),
    )
}

pub fn open_command(
    directory: &Path,
    home: &Path,
    plan: &TerminalPlan<'_>,
    launcher: &dyn Launcher,
) -> Result<(), AppError> {
    if !plan.placeholders.is_empty() {
        return Err(AppError::invalid_input(
            "命令含占位符，请先复制命令并在终端中替换后运行",
        ));
    }
    let owner = fs::metadata(home)
        .map_err(|_| AppError::permission_denied("无法确认主目录，已停止。"))?
        .uid();
    ensure_private_directory(directory, owner)?;
    sweep_expired(directory, SystemTime::now());
    if plan.command.chars().any(char::is_control) {
        return Err(AppError::invalid_input("命令含控制字符，已拒绝。"));
    }
    let work_dir = plan.work_dir.map(plain_text).transpose()?;
    let path = directory.join(format!("{SCRIPT_PREFIX}{}{SCRIPT_SUFFIX}", Uuid::new_v4()));
    let path_text = path.to_str().ok_or_else(AppError::internal)?;
    write_script(&path, &script_text(plan.command, work_dir.as_deref()))?;
    if launcher
        .run(Path::new(OPEN_PROGRAM), &open_arguments(path_text))
        .is_err()
    {
        let _ = fs::remove_file(&path);
        return Err(AppError::process_failed(
            "无法在 Terminal 中打开命令，请确认 Terminal 可用后重试。",
            true,
        ));
    }
    Ok(())
}

fn plain_text(path: &Path) -> Result<String, AppError> {
    let text = path
        .to_str()
        .ok_or_else(|| AppError::invalid_input("工作目录路径不是有效文本，已拒绝。"))?;
    check_value(text)
        .map_err(|_| AppError::invalid_input("工作目录路径含控制字符或过长，已拒绝。"))?;
    Ok(text.to_owned())
}

fn ensure_private_directory(directory: &Path, owner: u32) -> Result<(), AppError> {
    match fs::symlink_metadata(directory) {
        Ok(metadata) if metadata.file_type().is_dir() => check_private(&metadata, owner),
        Ok(_) => Err(AppError::permission_denied(
            "AI 终端临时目录不是普通目录，已停止。",
        )),
        Err(error) if error.kind() == io::ErrorKind::NotFound => DirBuilder::new()
            .recursive(true)
            .mode(DIRECTORY_MODE)
            .create(directory)
            .map_err(|_| AppError::permission_denied("AI 终端临时目录无法创建。")),
        Err(_) => Err(AppError::permission_denied("AI 终端临时目录无法访问。")),
    }
}

fn check_private(metadata: &Metadata, owner: u32) -> Result<(), AppError> {
    if metadata.uid() != owner || metadata.permissions().mode() & PERMISSION_BITS != DIRECTORY_MODE
    {
        return Err(AppError::permission_denied(
            "AI 终端临时目录必须属于当前用户且仅本人可访问，已停止。",
        ));
    }
    Ok(())
}

fn write_script(path: &Path, text: &str) -> Result<(), AppError> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(SCRIPT_MODE)
        .open(path)
        .map_err(|_| AppError::permission_denied("临时脚本无法创建。"))?;
    if file.write_all(text.as_bytes()).is_err() {
        let _ = fs::remove_file(path);
        return Err(AppError::permission_denied("临时脚本无法写入，已清理。"));
    }
    Ok(())
}

/// Removes scripts older than `MAX_SCRIPT_AGE` from `directory`. Only regular
/// files with the generated name are touched; symlinks are never followed.
pub fn sweep_expired(directory: &Path, now: SystemTime) {
    let Ok(metadata) = fs::symlink_metadata(directory) else {
        return;
    };
    if !metadata.file_type().is_dir() {
        return;
    }
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        if !is_script_name(&entry.file_name()) {
            continue;
        }
        let path = entry.path();
        let Ok(entry_metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if !entry_metadata.file_type().is_file() {
            continue;
        }
        let expired = entry_metadata
            .modified()
            .ok()
            .and_then(|modified| now.duration_since(modified).ok())
            .is_some_and(|age| age > MAX_SCRIPT_AGE);
        if expired {
            let _ = fs::remove_file(&path);
        }
    }
}

fn is_script_name(name: &OsStr) -> bool {
    name.to_str()
        .and_then(|text| text.strip_prefix(SCRIPT_PREFIX))
        .and_then(|rest| rest.strip_suffix(SCRIPT_SUFFIX))
        .is_some_and(|id| Uuid::parse_str(id).is_ok())
}

/// The directory the terminal scripts live in, below the app data directory.
pub fn terminal_directory(app_data: &Path) -> PathBuf {
    app_data.join(TERMINAL_DIRECTORY)
}

#[cfg(test)]
#[path = "terminal_tests.rs"]
mod tests;
