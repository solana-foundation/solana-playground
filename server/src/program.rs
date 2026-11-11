use std::{
    fs, io,
    path::{Path, PathBuf},
    process::Command,
    sync::LazyLock,
};

use anyhow::anyhow;
use regex::Regex;

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
    let output = Command::new("cargo-build-sbf")
        .env_clear()
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
        .args(["--", "--locked"])
        .output()?;

    // Check output length
    if output.stderr.len() > MAX_STDERR_LEN {
        return Err(anyhow!(
            "Exceeded maximum build output length: {} > {MAX_STDERR_LEN}",
            output.stderr.len()
        ));
    }

    let stderr = String::from_utf8(output.stderr)?;
    check_build_output(output.status.success(), stderr)
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
    fn tail_keeps_the_last_characters() {
        assert_eq!(tail("ab€", 2), "b€");
        assert_eq!(tail("ab", 5), "ab");
    }
}
