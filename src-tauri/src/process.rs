use std::{
    io::Read,
    path::Path,
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

use crate::process_session::{
    EnvSpec, GroupSignal, SessionError, grouped_command, kill_and_reap, peek_exit, signal_group,
};

const POLL_INTERVAL: Duration = Duration::from_millis(10);
/// Extra time to drain the pipes after the leader exits near the deadline.
const DRAIN_GRACE: Duration = Duration::from_millis(100);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProcessError {
    Spawn,
    Io,
    Timeout,
    OutputTooLarge,
    Failed {
        code: Option<i32>,
        stdout: String,
        stderr: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessOutput {
    pub stdout: String,
    pub stderr: String,
}

/// Environment a one-shot child receives.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EnvPolicy {
    /// Legacy behaviour: the child inherits this process's whole environment.
    /// Kept only for existing callers; new code should use `Explicit`.
    InheritLegacy,
    /// Cleared first; only the names in the spec are passed.
    Explicit(EnvSpec),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunOptions<'a> {
    pub env: EnvPolicy,
    pub cwd: Option<&'a Path>,
}

impl RunOptions<'_> {
    pub fn inherit_legacy() -> Self {
        Self {
            env: EnvPolicy::InheritLegacy,
            cwd: None,
        }
    }
}

/// Runs `executable` with the inherited environment (legacy behaviour).
///
/// On timeout the whole process group is killed and reaped.
pub fn run_bounded(
    executable: &Path,
    args: &[&str],
    timeout: Duration,
    max_output_bytes: usize,
) -> Result<ProcessOutput, ProcessError> {
    run_bounded_with(
        executable,
        args,
        timeout,
        max_output_bytes,
        &RunOptions::inherit_legacy(),
    )
}

type ReadResult = Result<(Vec<u8>, bool), ProcessError>;

/// Runs a command in its own process group without a shell. The leader stays
/// unreaped until the pipes are drained and the group has been cleaned up, so
/// group signals can never reach a process that reused the pid.
pub fn run_bounded_with(
    executable: &Path,
    args: &[&str],
    timeout: Duration,
    max_output_bytes: usize,
    options: &RunOptions<'_>,
) -> Result<ProcessOutput, ProcessError> {
    run_collected(executable, args, timeout, max_output_bytes, options, false)
        .map(|(output, _)| output)
}

/// Like [`run_bounded_with`], but output past `max_output_bytes` is cut instead
/// of failing. The flag reports whether stdout was cut. Text is decoded lossily
/// so a cut inside a UTF-8 sequence cannot fail the call.
pub fn run_bounded_truncated_with(
    executable: &Path,
    args: &[&str],
    timeout: Duration,
    max_output_bytes: usize,
    options: &RunOptions<'_>,
) -> Result<(ProcessOutput, bool), ProcessError> {
    run_collected(executable, args, timeout, max_output_bytes, options, true)
}

fn run_collected(
    executable: &Path,
    args: &[&str],
    timeout: Duration,
    max_output_bytes: usize,
    options: &RunOptions<'_>,
    keep_prefix: bool,
) -> Result<(ProcessOutput, bool), ProcessError> {
    let env = match &options.env {
        EnvPolicy::InheritLegacy => None,
        EnvPolicy::Explicit(spec) => {
            spec.validate()
                .map_err(|_: SessionError| ProcessError::Spawn)?;
            Some(spec)
        }
    };
    let mut child = grouped_command(executable, args.iter().copied(), options.cwd, env)
        .spawn()
        .map_err(|_| ProcessError::Spawn)?;
    let Ok(pid) = i32::try_from(child.id()) else {
        kill_and_reap(&mut child, None);
        return Err(ProcessError::Io);
    };
    let (Some(stdout), Some(stderr)) = (child.stdout.take(), child.stderr.take()) else {
        kill_and_reap(&mut child, Some(pid));
        return Err(ProcessError::Io);
    };

    let (sender, receiver) = mpsc::channel::<(bool, ReadResult)>();
    let stdout_sender = sender.clone();
    thread::spawn(move || {
        let _ = stdout_sender.send((true, read_bounded(stdout, max_output_bytes, keep_prefix)));
    });
    thread::spawn(move || {
        let _ = sender.send((false, read_bounded(stderr, max_output_bytes, keep_prefix)));
    });

    let deadline = Instant::now() + timeout;
    loop {
        match peek_exit(pid, false) {
            Ok(true) => break,
            Ok(false) => {}
            Err(_) => {
                kill_and_reap(&mut child, Some(pid));
                return Err(ProcessError::Io);
            }
        }
        if Instant::now() >= deadline {
            kill_and_reap(&mut child, Some(pid));
            return Err(ProcessError::Timeout);
        }
        thread::sleep(POLL_INTERVAL);
    }

    // The leader is a zombie and still reserves the group id. Wait for the pipes
    // to close; a descendant that keeps them open past the deadline is killed
    // with the rest of the group.
    let drain_deadline = deadline.max(Instant::now() + DRAIN_GRACE);
    let mut stdout_result = None;
    let mut stderr_result = None;
    while stdout_result.is_none() || stderr_result.is_none() {
        let remaining = drain_deadline.saturating_duration_since(Instant::now());
        match receiver.recv_timeout(remaining) {
            Ok((true, result)) => stdout_result = Some(result),
            Ok((false, result)) => stderr_result = Some(result),
            Err(_) => {
                kill_and_reap(&mut child, Some(pid));
                return Err(ProcessError::Timeout);
            }
        }
    }

    // Clear stragglers that closed their pipes but stayed in the group, then reap.
    let _ = signal_group(pid, GroupSignal::Kill);
    let status = child.wait().map_err(|_| ProcessError::Io)?;

    let (stdout, stdout_cut) = stdout_result.ok_or(ProcessError::Io)??;
    let (stderr, _) = stderr_result.ok_or(ProcessError::Io)??;
    let stdout = decode_output(stdout, keep_prefix)?;
    let stderr = decode_output(stderr, keep_prefix)?;

    if !status.success() {
        return Err(ProcessError::Failed {
            code: status.code(),
            stdout,
            stderr,
        });
    }

    Ok((ProcessOutput { stdout, stderr }, stdout_cut))
}

fn decode_output(bytes: Vec<u8>, lossy: bool) -> Result<String, ProcessError> {
    if lossy {
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    } else {
        String::from_utf8(bytes).map_err(|_| ProcessError::Io)
    }
}

fn read_bounded(
    mut reader: impl Read,
    limit: usize,
    keep_prefix: bool,
) -> Result<(Vec<u8>, bool), ProcessError> {
    let mut output = Vec::with_capacity(limit.min(8 * 1024));
    let mut exceeded = false;
    let mut buffer = [0_u8; 8 * 1024];

    loop {
        let read = reader.read(&mut buffer).map_err(|_| ProcessError::Io)?;
        if read == 0 {
            break;
        }

        let room = limit - output.len();
        if read <= room {
            output.extend_from_slice(&buffer[..read]);
        } else {
            exceeded = true;
            if keep_prefix {
                output.extend_from_slice(&buffer[..room]);
            }
        }
    }

    if exceeded && !keep_prefix {
        Err(ProcessError::OutputTooLarge)
    } else {
        Ok((output, exceeded))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn captures_argument_array_output_without_a_shell() {
        let output = run_bounded(
            Path::new("/usr/bin/printf"),
            &["%s", "hello world"],
            Duration::from_secs(1),
            64,
        )
        .expect("printf should succeed");

        assert_eq!(output.stdout, "hello world");
    }

    #[test]
    fn rejects_output_over_the_limit() {
        let error = run_bounded(
            Path::new("/usr/bin/printf"),
            &["%s", "0123456789"],
            Duration::from_secs(1),
            4,
        )
        .expect_err("oversized output should fail");

        assert_eq!(error, ProcessError::OutputTooLarge);
    }
}
