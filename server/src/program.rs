use std::{
    collections::HashSet,
    fs,
    io::{self, Read},
    os::unix::process::CommandExt,
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::{
        mpsc::{self, RecvTimeoutError},
        LazyLock, Mutex, MutexGuard, PoisonError,
    },
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

/// How long a program's build directory is kept after its last build
const BUILD_DIR_RETENTION: Duration = Duration::from_secs(24 * 60 * 60);

/// Build the program from the given program name and files.
///
/// `program_name` is only being used as the directory name of the program and it doesn't have an
/// effect on the name in `Cargo.toml`.
///
/// Only Rust source files starting with `/src` are allowed to be passed in, an error is returned
/// otherwise.
///
/// The build's process tree is stopped once `time_limit` passes, and an error is returned.
///
/// NOTE: This function doesn't return an error in the case of a compiler error, only for other
/// build failures.
///
/// No IDL is produced: Anchor 1.x builds one only by compiling and running user code
/// (`idl-build`), which this route does not do.
// TODO: Remove
pub fn build(
    concurrency_id: usize,
    program_name: &str,
    files: &Files,
    time_limit: Duration,
) -> anyhow::Result<String> {
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

    // Keep the cleanup away from this program's directory while it builds
    let _building = Building::start(program_name);

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

    // Stamp the directory as used now: the cleanup counts its age from this build
    fs::File::open(&program_path)?.set_modified(SystemTime::now())?;

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
    let (status, stderr) = run_with_time_limit(&mut cmd, time_limit, STDERR_GRACE)
        .inspect_err(|e| warn!("Build of {program_name} in slot {concurrency_id}: {e}"))?;

    // Check output length
    if stderr.len() > MAX_STDERR_LEN {
        return Err(anyhow!(
            "Exceeded maximum build output length of {MAX_STDERR_LEN} bytes"
        ));
    }

    let stderr = String::from_utf8(stderr)?;
    check_build_output(status.success(), stderr)
}

/// How often [`run_with_time_limit`] checks whether the process has ended
const POLL_INTERVAL: Duration = Duration::from_millis(50);

/// How long stderr may stay open after the build process has exited
const STDERR_GRACE: Duration = Duration::from_secs(5);

/// Run `cmd` in a process group of its own and return its exit status and stderr.
///
/// Once `limit` passes, the process group is killed, which stops the compiler processes `cmd`
/// started unless one left the group, and an error saying the build timed out is returned.
/// A process left in the group that still holds stderr open after the build process exits is
/// killed after `grace`, and the output read so far is returned with the build's status.
/// Stderr is kept up to one byte past [`MAX_STDERR_LEN`], enough for the caller to see it was
/// exceeded; the rest is drained.
fn run_with_time_limit(
    cmd: &mut Command,
    limit: Duration,
    grace: Duration,
) -> anyhow::Result<(ExitStatus, Vec<u8>)> {
    let deadline = Instant::now() + limit;
    let mut child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .process_group(0)
        .spawn()?;
    let stderr = child.stderr.take().expect("stderr is piped");
    let mut group = ProcessGroup(child);

    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || sender.send(read_capped(stderr, MAX_STDERR_LEN + 1)));

    let status = loop {
        if let Some(status) = group.0.try_wait()? {
            break status;
        }
        if Instant::now() >= deadline {
            // Dropping `group` kills the group and reaps the build process
            return Err(anyhow!("Build timed out after {} seconds", limit.as_secs()));
        }
        thread::sleep(POLL_INTERVAL);
    };

    let output_error = || anyhow!("Failed to read the build output");
    let stderr = match receiver.recv_timeout(grace) {
        Ok(stderr) => stderr,
        Err(RecvTimeoutError::Timeout) => {
            kill_group(group.0.id());
            receiver.recv_timeout(grace).map_err(|_| output_error())?
        }
        Err(RecvTimeoutError::Disconnected) => return Err(output_error()),
    };
    Ok((
        status,
        stderr.map_err(|e| anyhow!("{}: {e}", output_error()))?,
    ))
}

/// A build process leading its own process group.
///
/// Dropped before the build process has been reaped, it kills the group and reaps the process,
/// so no path out of [`run_with_time_limit`] leaves a build running.
struct ProcessGroup(Child);

impl Drop for ProcessGroup {
    fn drop(&mut self) {
        if let Ok(Some(_)) = self.0.try_wait() {
            return;
        }
        kill_group(self.0.id());
        if let Err(e) = self.0.kill() {
            error!("Failed to kill build process {}: {e}", self.0.id());
        }
        if let Err(e) = self.0.wait() {
            error!("Failed to reap build process {}: {e}", self.0.id());
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
///
/// The group id is the build process's pid. While the build process is not reaped, or the group
/// still has a member, the kernel does not hand that id to another process or group.
fn kill_group(group: u32) {
    let Ok(group) = i32::try_from(group) else {
        error!("Process group id out of range: {group}");
        return;
    };
    // SAFETY: `kill` takes no pointers; a negative pid addresses a process group.
    if unsafe { libc::kill(-group, libc::SIGKILL) } != 0 {
        let e = io::Error::last_os_error();
        // ESRCH: the group is already empty. EPERM: macOS answers so for a group whose only
        // member is a zombie.
        if !matches!(e.raw_os_error(), Some(libc::ESRCH | libc::EPERM)) {
            error!("Failed to kill process group {group}: {e}");
        }
    }
}

/// Programs whose build is running, so the cleanup leaves their directories alone
static BUILDING: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);

/// Lock [`BUILDING`], whose set stays valid even if a holder panicked.
fn building() -> MutexGuard<'static, HashSet<String>> {
    BUILDING.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Marks a program as building until dropped.
struct Building(String);

impl Building {
    fn start(program_name: &str) -> Self {
        building().insert(program_name.to_owned());
        Self(program_name.to_owned())
    }
}

impl Drop for Building {
    fn drop(&mut self) {
        building().remove(&self.0);
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

/// Remove the program build directories under `root` last used more than `retention` before
/// `now`, and return how many were removed.
///
/// Only directories named by a program UUID are build directories: the concurrency slots, the
/// manifest and the default program stay. [`build`] stamps its directory's modification time,
/// so the age counts from the last build, and a directory whose build is running is skipped.
fn remove_build_dirs_older_than(root: &Path, retention: Duration, now: SystemTime) -> usize {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return 0,
        Err(e) => {
            error!("Failed to read {}: {e}", root.display());
            return 0;
        }
    };

    let mut removed = 0;
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(e) => {
                warn!("Failed to read an entry of {}: {e}", root.display());
                continue;
            }
        };
        let Some(name) = entry.file_name().to_str().map(ToOwned::to_owned) else {
            continue;
        };
        if Uuid::try_parse(&name).is_err() {
            continue;
        }

        // Held through the removal, so a build of this program cannot start meanwhile
        let building = building();
        if building.contains(&name) {
            continue;
        }
        let path = entry.path();
        let modified = match fs::metadata(&path).and_then(|meta| meta.modified()) {
            Ok(modified) => modified,
            Err(e) => {
                warn!("Failed to read the age of {}: {e}", path.display());
                continue;
            }
        };
        // A modification time after `now` is not old
        let is_old = now
            .duration_since(modified)
            .is_ok_and(|age| age > retention);
        if !is_old || !path.is_dir() {
            continue;
        }
        match fs::remove_dir_all(&path) {
            Ok(()) => removed += 1,
            Err(e) => error!("Failed to remove {}: {e}", path.display()),
        }
        drop(building);
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
            STDERR_GRACE,
        )
        .unwrap();
        assert!(status.success());
        assert_eq!(stderr, b"built\n");
    }

    #[test]
    fn run_with_time_limit_stops_the_process_group_at_the_limit() {
        let dir = test_dir();
        let pid_file = dir.join("pid");
        let script = format!("sleep 30 & echo $! > {}; wait", pid_file.display());
        let started = Instant::now();

        let error = run_with_time_limit(
            Command::new("sh").args(["-c", &script]),
            Duration::from_secs(2),
            STDERR_GRACE,
        )
        .unwrap_err();

        assert_eq!(error.to_string(), "Build timed out after 2 seconds");
        assert!(started.elapsed() < Duration::from_secs(6));
        let child = read_pid(&pid_file);
        assert!(eventually(|| !is_running(child)), "child {child} survived");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn run_with_time_limit_returns_the_output_when_a_child_keeps_stderr_open() {
        // The build process exits at once; the child it leaves behind keeps stderr open
        let dir = test_dir();
        let pid_file = dir.join("pid");
        let script = format!(
            "echo built >&2; sleep 30 & echo $! > {}",
            pid_file.display()
        );
        let started = Instant::now();

        let (status, stderr) = run_with_time_limit(
            Command::new("sh").args(["-c", &script]),
            Duration::from_secs(30),
            Duration::from_millis(500),
        )
        .unwrap();

        assert!(status.success());
        assert_eq!(stderr, b"built\n");
        assert!(started.elapsed() < Duration::from_secs(5));
        let child = read_pid(&pid_file);
        assert!(eventually(|| !is_running(child)), "child {child} survived");
        fs::remove_dir_all(dir).unwrap();
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
        let building_now = root.join(Uuid::new_v4().to_string());
        let slot = root.join("0");
        for dir in [&old, &recent, &building_now, &slot] {
            fs::create_dir_all(dir.join("src")).unwrap();
        }
        fs::write(root.join("Cargo.toml"), "").unwrap();
        let day = Duration::from_secs(24 * 60 * 60);
        let now = SystemTime::now() + day + Duration::from_secs(60);
        // Only `recent` was built since
        fs::File::open(&recent).unwrap().set_modified(now).unwrap();
        let building_name = building_now.file_name().unwrap().to_str().unwrap();
        let building = Building::start(building_name);

        assert_eq!(remove_build_dirs_older_than(&root, day, now), 1);

        assert!(!old.exists());
        assert!(recent.exists());
        assert!(building_now.exists());
        assert!(slot.exists());
        assert!(root.join("Cargo.toml").exists());

        drop(building);
        assert_eq!(remove_build_dirs_older_than(&root, day, now), 1);
        assert!(!building_now.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn remove_build_dirs_older_than_ignores_a_missing_root() {
        let root = std::env::temp_dir().join(format!("solpg-test-{}", Uuid::new_v4()));
        assert_eq!(
            remove_build_dirs_older_than(&root, Duration::ZERO, SystemTime::now()),
            0
        );
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

    /// The pid a test script wrote, once it is there
    fn read_pid(path: &Path) -> i32 {
        assert!(eventually(|| path.exists()), "no pid in {}", path.display());
        fs::read_to_string(path).unwrap().trim().parse().unwrap()
    }

    /// Whether `pid` is alive; a zombie, which `kill(pid, 0)` still finds, is not
    fn is_running(pid: i32) -> bool {
        let output = Command::new("ps")
            .args(["-o", "stat=", "-p", &pid.to_string()])
            .output()
            .unwrap();
        let state = String::from_utf8_lossy(&output.stdout);
        let state = state.trim();
        !state.is_empty() && !state.starts_with('Z')
    }

    #[test]
    fn tail_keeps_the_last_characters() {
        assert_eq!(tail("ab€", 2), "b€");
        assert_eq!(tail("ab", 5), "ab");
    }
}
