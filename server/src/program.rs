use std::{
    fs,
    io::{self, Read},
    os::unix::process::CommandExt,
    path::{Path, PathBuf},
    process::{Command, ExitStatus, Stdio},
    sync::{mpsc, LazyLock},
    thread,
    time::{Duration, Instant, SystemTime},
};

use anyhow::anyhow;
use regex::Regex;
use uuid::Uuid;

use crate::{
    log::{error, info, warn},
    utils::Files,
};

/// Directory name of where the programs are stored
const PROGRAMS_DIR: &str = "programs";

/// Program binary file name
pub const BINARY_FILE: &str = "binary.so";

/// Maximum amount of files to pass to the [`build`] function
pub const MAX_FILE_AMOUNT: usize = 64;

/// Maximum length of the file paths to pass to the [`build`] function
pub const MAX_PATH_LEN: usize = 128;

/// Max program build output stderr length
pub const MAX_STDERR_LEN: usize = 1024 * 1024; // 1 MiB

/// How many characters of a failed build's stderr the server log keeps
const LOGGED_STDERR_LEN: usize = 4096;

/// How long a build may run before its process tree is stopped.
///
/// Generous on purpose: the first build in a concurrency slot compiles every dependency.
pub const BUILD_TIME_LIMIT: Duration = Duration::from_secs(10 * 60);

/// How long a program's build directory is kept after its last build
pub const BUILD_DIR_RETENTION: Duration = Duration::from_secs(24 * 60 * 60);

/// Build the program from the given program name and files.
///
/// `program_name` is only being used as the directory name of the program and it doesn't have an
/// effect on the name in `Cargo.toml`.
///
/// Only Rust source files starting with `/src` are allowed to be passed in, an error is returned
/// otherwise.
///
/// NOTE: This function doesn't return an error in the case of a compiler error, only for other
/// build failures.
///
/// No IDL is produced: Anchor 1.x builds one only by compiling and running user code
/// (`idl-build`), which this route does not do.
// TODO: Remove
pub fn build(concurrency_id: usize, program_name: &str, files: &Files) -> anyhow::Result<String> {
    // Check file count
    if files.len() > MAX_FILE_AMOUNT {
        return Err(anyhow!(
            "Exceeded maximum file amount: {} > {MAX_FILE_AMOUNT}",
            files.len()
        ));
    }

    // Check file paths
    static ALLOWED_REGEX: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"^/src/[\w/-]+\.rs$").unwrap());
    for (path, _) in files {
        let is_valid = path.len() <= MAX_PATH_LEN
            && !path.contains("..")
            && !path.contains("//")
            && ALLOWED_REGEX.is_match(path);
        if !is_valid {
            return Err(anyhow!("Invalid path: {path}"));
        }
    }

    // Copy `Cargo.toml` into a separate directory (only once)
    let concurrency_path = Path::new(PROGRAMS_DIR).join(concurrency_id.to_string());
    let concurrency_ready_path = concurrency_path.join("ready");
    if !fs::exists(&concurrency_ready_path)? {
        info!("Initializing concurrency id {concurrency_id}");
        fs::create_dir_all(&concurrency_path)?;
        fs::copy(
            Path::new(PROGRAMS_DIR).join("Cargo.toml"),
            concurrency_path.join("Cargo.toml"),
        )?;
        fs::write(concurrency_ready_path, [])?;
        info!("Initialized concurrency id {concurrency_id}");
    }

    // A slot that survives an image upgrade would otherwise keep the old lock beside the new manifest
    fs::copy(
        Path::new(PROGRAMS_DIR).join("Cargo.lock"),
        concurrency_path.join("Cargo.lock"),
    )?;

    // Remove existing files
    //
    // TODO: Compare with existing files and only remove the unused ones instead of removing all
    let program_path = Path::new(PROGRAMS_DIR).join(program_name);
    if let Err(e) = fs::remove_dir_all(program_path.join("src")) {
        if e.kind() != io::ErrorKind::NotFound {
            return Err(anyhow!("Failed to remove existing files: {e}"));
        }
    };

    // Write files
    for (path, content) in files {
        let relative_path = path.trim_start_matches('/');
        let item_path = program_path.join(relative_path);

        // Create directories when necessary
        let parent_path = item_path.parent().expect("Must have parent");
        fs::create_dir_all(parent_path)?;

        // Write file
        fs::write(item_path, content)?;
    }

    // Update manifest
    static MANIFEST: LazyLock<String> = LazyLock::new(|| {
        fs::read_to_string(Path::new(PROGRAMS_DIR).join("Cargo.toml"))
            .expect("Could not read manifest")
    });
    let manifest_path = concurrency_path.join("Cargo.toml");
    fs::write(
        &manifest_path,
        MANIFEST.replacen("default", &format!("../{program_name}"), 1),
    )?;

    // Build the program with a clean env, inheriting only toolchain locator vars from the parent.
    let mut cmd = Command::new("cargo-build-sbf");
    cmd.env_clear()
        .envs(["PATH", "HOME"].into_iter().filter_map(|key| {
            std::env::var(key)
                .inspect_err(|e| warn!("Failed to get env variable: `{key}`: {e}"))
                .ok()
                .map(|value| (key, value))
        }))
        .arg("--manifest-path")
        .arg(manifest_path)
        .arg("--sbf-out-dir")
        .arg(&program_path)
        .arg("--offline")
        .args(["--", "--locked"]);
    let (status, stderr) = run_with_time_limit(&mut cmd, BUILD_TIME_LIMIT)?;

    // Check output length
    if stderr.len() > MAX_STDERR_LEN {
        return Err(anyhow!(
            "Exceeded maximum build output length: {} > {MAX_STDERR_LEN}",
            stderr.len()
        ));
    }

    let stderr = String::from_utf8(stderr)?;
    check_build_output(status.success(), stderr)
}

/// How often [`run_with_time_limit`] checks whether the process has ended
const POLL_INTERVAL: Duration = Duration::from_millis(50);

/// Run `cmd` in a process group of its own and return its exit status and stderr.
///
/// Once `limit` passes, the whole group is killed, so the compiler processes `cmd` started stop
/// with it, and an error saying the build timed out is returned. Stderr is kept up to one byte
/// past [`MAX_STDERR_LEN`], enough for the caller to see it was exceeded; the rest is drained.
fn run_with_time_limit(
    cmd: &mut Command,
    limit: Duration,
) -> anyhow::Result<(ExitStatus, Vec<u8>)> {
    let deadline = Instant::now() + limit;
    let mut child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .process_group(0)
        .spawn()?;
    let group = child.id();
    let timed_out = || anyhow!("Build timed out after {} seconds", limit.as_secs());

    let stderr = child.stderr.take().expect("stderr is piped");
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || sender.send(read_capped(stderr, MAX_STDERR_LEN + 1)));

    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if Instant::now() >= deadline {
            kill_group(group);
            child.wait()?;
            return Err(timed_out());
        }
        thread::sleep(POLL_INTERVAL);
    };

    // A process left in the group may still hold stderr open after the build process exits
    match receiver.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
        Ok(stderr) => Ok((status, stderr?)),
        Err(_) => {
            kill_group(group);
            Err(timed_out())
        }
    }
}

/// Read up to `cap` bytes and drain the rest, so the writer never blocks on a full pipe.
fn read_capped(reader: impl Read, cap: usize) -> io::Result<Vec<u8>> {
    let mut reader = reader;
    let mut kept = Vec::new();
    reader.by_ref().take(cap as u64).read_to_end(&mut kept)?;
    io::copy(&mut reader, &mut io::sink())?;
    Ok(kept)
}

/// Kill every process in the process group `group`.
fn kill_group(group: u32) {
    let Ok(group) = i32::try_from(group) else {
        error!("Process group id out of range: {group}");
        return;
    };
    // SAFETY: `kill` takes no pointers. A negative pid addresses the group the build process
    // leads, and the kernel does not hand out an id still in use as a process group id.
    if unsafe { libc::kill(-group, libc::SIGKILL) } != 0 {
        let e = io::Error::last_os_error();
        if e.raw_os_error() != Some(libc::ESRCH) {
            error!("Failed to kill process group {group}: {e}");
        }
    }
}

/// Remove the program build directories under the programs directory that no build has used
/// for longer than [`BUILD_DIR_RETENTION`].
pub fn remove_old_build_dirs() {
    remove_build_dirs_older_than(
        Path::new(PROGRAMS_DIR),
        BUILD_DIR_RETENTION,
        SystemTime::now(),
    );
}

/// Remove the program build directories under `root` last changed more than `retention` before
/// `now`, and return how many were removed.
///
/// Only directories named by a program UUID are build directories: the concurrency slots, the
/// manifest and the default program stay. A build rewrites its directory's `src`, which updates
/// the directory's modification time, so the age counts from the last build.
fn remove_build_dirs_older_than(root: &Path, retention: Duration, now: SystemTime) -> usize {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(e) => {
            error!("Failed to read {}: {e}", root.display());
            return 0;
        }
    };

    let mut removed = 0;
    for entry in entries.flatten() {
        let is_build_dir = entry
            .file_name()
            .to_str()
            .is_some_and(|name| Uuid::try_parse(name).is_ok());
        if !is_build_dir {
            continue;
        }
        let is_old = entry
            .metadata()
            .and_then(|meta| meta.modified())
            .is_ok_and(|modified| {
                now.duration_since(modified)
                    .is_ok_and(|age| age > retention)
            });
        if !is_old {
            continue;
        }
        match fs::remove_dir_all(entry.path()) {
            Ok(()) => removed += 1,
            Err(e) => error!("Failed to remove {}: {e}", entry.path().display()),
        }
    }

    if removed > 0 {
        info!("Removed {removed} old build directories");
    }
    removed
}

/// Marks the compiler errors the client shows to the user as a failed build
const COMPILE_ERROR_MARKER: &str = "error: could not compile";

/// Return the stderr of a build that succeeded or failed to compile, and an error otherwise.
fn check_build_output(success: bool, stderr: String) -> anyhow::Result<String> {
    // The client reads failure only from the compile error marker, so any other failure would pass as success
    if !success && !stderr.contains(COMPILE_ERROR_MARKER) {
        // The output names server paths and the toolchain, so only the server log sees it
        error!(
            "Build failed outside the compiler: {}",
            tail(&stderr, LOGGED_STDERR_LEN)
        );
        return Err(anyhow!("Build failed on the server"));
    }

    Ok(stderr)
}

/// The last `max_chars` characters of `text`, where cargo prints the cause
fn tail(text: &str, max_chars: usize) -> &str {
    let start = text
        .char_indices()
        .rev()
        .nth(max_chars.saturating_sub(1))
        .map_or(0, |(index, _)| index);
    &text[start..]
}

/// Read the program ELF and return its bytes.
///
/// In order for the program binary to exist, the program must be built using the [`build`] function
/// before this command is executed.
// TODO: Remove
pub async fn get_binary(program_name: &str) -> tokio::io::Result<Vec<u8>> {
    let binary_path = Path::new(PROGRAMS_DIR).join(program_name).join("solpg.so");
    tokio::fs::read(binary_path).await
}

/// Get the path to the process output directory.
pub fn get_out_path() -> PathBuf {
    Path::new(PROGRAMS_DIR).join("out")
}

/// Get the path to the program output directory.
pub fn get_program_out_path(uuid: &str) -> PathBuf {
    get_out_path().join(uuid)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_build_output_passes_success_and_compile_errors() {
        assert!(check_build_output(true, String::new()).is_ok());
        let compile_error = format!("{COMPILE_ERROR_MARKER} `solpg`");
        assert_eq!(
            check_build_output(false, compile_error.clone()).unwrap(),
            compile_error
        );
    }

    #[test]
    fn check_build_output_rejects_other_failures_without_their_output() {
        let error = check_build_output(false, "error: no matching package".into()).unwrap_err();
        assert_eq!(error.to_string(), "Build failed on the server");
    }

    #[test]
    fn run_with_time_limit_returns_status_and_stderr_within_the_limit() {
        let (status, stderr) = run_with_time_limit(
            Command::new("sh").args(["-c", "echo built >&2"]),
            Duration::from_secs(10),
        )
        .unwrap();
        assert!(status.success());
        assert_eq!(stderr, b"built\n");
    }

    #[test]
    fn run_with_time_limit_stops_the_process_tree_at_the_limit() {
        let dir = test_dir();
        let pid_file = dir.join("pid");
        let script = format!("sleep 30 & echo $! > {}; wait", pid_file.display());
        let started = Instant::now();

        let error = run_with_time_limit(
            Command::new("sh").args(["-c", &script]),
            Duration::from_secs(1),
        )
        .unwrap_err();

        assert_eq!(error.to_string(), "Build timed out after 1 seconds");
        assert!(started.elapsed() < Duration::from_secs(5));
        let child: i32 = fs::read_to_string(&pid_file)
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        assert!(eventually(|| !is_running(child)), "child {child} survived");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn run_with_time_limit_stops_a_child_that_outlives_the_build_process() {
        // The leader exits at once; the child it leaves behind keeps stderr open
        let started = Instant::now();
        let error = run_with_time_limit(
            Command::new("sh").args(["-c", "sleep 30 &"]),
            Duration::from_secs(1),
        )
        .unwrap_err();
        assert_eq!(error.to_string(), "Build timed out after 1 seconds");
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn read_capped_keeps_the_cap_and_drains_the_rest() {
        let input = vec![b'x'; 10_000];
        let mut reader = &input[..];
        assert_eq!(read_capped(&mut reader, 10).unwrap(), vec![b'x'; 10]);
        assert!(reader.is_empty());
    }

    #[test]
    fn remove_build_dirs_older_than_removes_only_old_program_dirs() {
        let root = test_dir();
        let old = root.join(Uuid::new_v4().to_string());
        let recent = root.join(Uuid::new_v4().to_string());
        let slot = root.join("0");
        for dir in [&old, &recent, &slot] {
            fs::create_dir_all(dir.join("src")).unwrap();
        }
        fs::write(root.join("Cargo.toml"), "").unwrap();
        let day = Duration::from_secs(24 * 60 * 60);
        let now = SystemTime::now() + day + Duration::from_secs(60);
        // Only `recent` was built since
        fs::File::open(&recent).unwrap().set_modified(now).unwrap();

        assert_eq!(remove_build_dirs_older_than(&root, day, now), 1);

        assert!(!old.exists());
        assert!(recent.exists());
        assert!(slot.exists());
        assert!(root.join("Cargo.toml").exists());
        fs::remove_dir_all(root).unwrap();
    }

    /// A fresh directory under the system temp directory
    fn test_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!("solpg-test-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// Whether `condition` holds within two seconds
    fn eventually(condition: impl Fn() -> bool) -> bool {
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            if condition() {
                return true;
            }
            thread::sleep(Duration::from_millis(20));
        }
        false
    }

    fn is_running(pid: i32) -> bool {
        // SAFETY: signal 0 only checks that the process exists
        unsafe { libc::kill(pid, 0) == 0 }
    }

    #[test]
    fn tail_keeps_the_last_characters() {
        assert_eq!(tail("ab€", 2), "b€");
        assert_eq!(tail("ab", 5), "ab");
    }
}
