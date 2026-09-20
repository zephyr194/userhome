use std::{
    io::Read,
    path::Path,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

const POLL_INTERVAL: Duration = Duration::from_millis(10);

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

pub fn run_bounded(
    executable: &Path,
    args: &[&str],
    timeout: Duration,
    max_output_bytes: usize,
) -> Result<ProcessOutput, ProcessError> {
    let mut child = Command::new(executable)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| ProcessError::Spawn)?;

    let stdout = child.stdout.take().ok_or(ProcessError::Io)?;
    let stderr = child.stderr.take().ok_or(ProcessError::Io)?;
    let stdout_reader = thread::spawn(move || read_bounded(stdout, max_output_bytes));
    let stderr_reader = thread::spawn(move || read_bounded(stderr, max_output_bytes));

    let started_at = Instant::now();
    let status = loop {
        match child.try_wait().map_err(|_| ProcessError::Io)? {
            Some(status) => break status,
            None if started_at.elapsed() >= timeout => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Err(ProcessError::Timeout);
            }
            None => thread::sleep(POLL_INTERVAL),
        }
    };

    let stdout = stdout_reader.join().map_err(|_| ProcessError::Io)??;
    let stderr = stderr_reader.join().map_err(|_| ProcessError::Io)??;
    let stdout = String::from_utf8(stdout).map_err(|_| ProcessError::Io)?;
    let stderr = String::from_utf8(stderr).map_err(|_| ProcessError::Io)?;

    if !status.success() {
        return Err(ProcessError::Failed {
            code: status.code(),
            stdout,
            stderr,
        });
    }

    Ok(ProcessOutput { stdout, stderr })
}

fn read_bounded(mut reader: impl Read, limit: usize) -> Result<Vec<u8>, ProcessError> {
    let mut output = Vec::with_capacity(limit.min(8 * 1024));
    let mut exceeded = false;
    let mut buffer = [0_u8; 8 * 1024];

    loop {
        let read = reader.read(&mut buffer).map_err(|_| ProcessError::Io)?;
        if read == 0 {
            break;
        }

        if output.len().saturating_add(read) <= limit {
            output.extend_from_slice(&buffer[..read]);
        } else {
            exceeded = true;
        }
    }

    if exceeded {
        Err(ProcessError::OutputTooLarge)
    } else {
        Ok(output)
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
