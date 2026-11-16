use std::sync::{Arc, Mutex};

use anyhow::anyhow;
use axum::{
    extract::{Json, State},
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use solpg_server::{program, utils::Files, Result};
use tokio::{
    sync::Semaphore,
    task,
    time::{interval, Duration},
};
use uuid::Uuid;

/// Build request
#[derive(Deserialize)]
pub struct BuildRequest {
    /// Program files to build
    files: Files,
    /// UUID of the program.
    ///
    /// In the first ever request from a client, this will not exist and [`BuildResponse`] will
    /// return a `uuid`. Client is responsible for saving the `uuid` and using it with every
    /// subseqent requests in order to save resources not re-creating the project.
    uuid: Option<String>,
    // Clients still send IDL `flags`; serde ignores unknown fields, so the request stays valid.
}

/// Build response
#[derive(Serialize)]
struct BuildResponse {
    /// Solana build tools output to `stderr` regardless of the compilation status
    stderr: String,
    /// UUID of the program, `None` if the [`BuildRequest`] includes `uuid`
    uuid: Option<String>,
    /// Always `None`; the key stays so clients that read it keep parsing the response
    idl: Option<serde_json::Value>,
}

/// Build state
#[derive(Clone)]
pub struct BuildState {
    /// Semaphore to limit concurrent requests
    sem: Arc<Semaphore>,
    /// A set of current requests based on availability (capped by `sem`)
    ids: Arc<Mutex<Vec<bool>>>,
}

/// How often old build directories are looked for
const BUILD_DIR_CLEANUP_INTERVAL: Duration = Duration::from_secs(60 * 60);

impl BuildState {
    /// Create a new value with the maximum amount of concurrent builds, and start removing old
    /// build directories in the background.
    pub fn new(concurrency: usize) -> Self {
        tokio::spawn(async {
            let mut ticks = interval(BUILD_DIR_CLEANUP_INTERVAL);
            loop {
                ticks.tick().await;
                if let Err(e) = task::spawn_blocking(program::remove_old_build_dirs).await {
                    crate::log::error!("Failed to remove old build directories: {e}");
                }
            }
        });
        Self::with_concurrency(concurrency)
    }

    /// Create a new value with the maximum amount of concurrent builds.
    fn with_concurrency(concurrency: usize) -> Self {
        Self {
            sem: Arc::new(Semaphore::new(concurrency)),
            ids: Arc::new(Mutex::new(vec![false; concurrency])),
        }
    }
}

/// Build the program.
pub async fn build(
    State(state): State<BuildState>,
    Json(payload): Json<BuildRequest>,
) -> Result<impl IntoResponse> {
    let (uuid, respond_with_uuid) = match payload.uuid {
        Some(uuid) => Uuid::try_parse(&uuid)
            .map(|_| (uuid, false))
            .map_err(|_| anyhow!("Invalid UUID"))?,
        None => (Uuid::new_v4().to_string(), true),
    };

    // Only permit a certain number of builds concurrently
    let permit = concurrent::Permit::acquire(state).await?;
    let (build_result, uuid) = run_holding(permit, move |concurrency_id| {
        (program::build(concurrency_id, &uuid, &payload.files), uuid)
    })
    .await?;
    let stderr = build_result?;

    Ok(Json(BuildResponse {
        stderr,
        uuid: if respond_with_uuid { Some(uuid) } else { None },
        idl: None,
    }))
}

/// Run `f` with the permit's id on the blocking pool, so it does not block the thread.
///
/// The permit moves into the blocking task and is released when `f` returns. A request that ends
/// early drops only this future: the build goes on, and keeps its slot until it has ended.
async fn run_holding<T, F>(permit: concurrent::Permit, f: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce(usize) -> T + Send + 'static,
{
    task::spawn_blocking(move || {
        let output = f(permit.id());
        drop(permit);
        output
    })
    .await
    .map_err(|e| anyhow!("Failed to run `spawn_blocking`: {e}").into())
}

/// Concurrency helpers
mod concurrent {
    use tokio::sync::OwnedSemaphorePermit;

    use super::*;
    use crate::log::error;

    /// A utility type to manage concurrent permits.
    pub(super) struct Permit {
        /// Permit id
        id: usize,
        /// An owned semaphore permit used to limit concurrent requests
        #[allow(unused)]
        permit: OwnedSemaphorePermit,
        /// Build state
        state: BuildState,
    }

    impl Permit {
        /// Acquire a permit.
        ///
        /// # Note
        ///
        /// This function takes ownership of [`BuildState`], even though it doesn't need to, in
        /// order to help make sure the ids [`Mutex`] doesn't get used anywhere else. This is done
        /// to limit the usage of `state.ids` and make sure it never gets poisoned.
        pub async fn acquire(state: BuildState) -> Result<Self> {
            let permit = state
                .sem
                .clone()
                .acquire_owned()
                .await
                .map_err(|e| anyhow!("Failed to acquire `Semaphore`: {e}"))?;

            let mut ids = state
                .ids
                .lock()
                .map_err(|e| anyhow!("Failed to lock ids: {e}"))?;
            let id = ids
                .iter()
                .enumerate()
                .find_map(|(id, used)| (!used).then_some(id))
                .ok_or_else(|| anyhow!("Failed to find concurrency id"))?;
            ids[id] = true;
            drop(ids);

            Ok(Self { id, permit, state })
        }

        /// Get the permit ID.
        pub fn id(&self) -> usize {
            self.id
        }
    }

    impl Drop for Permit {
        fn drop(&mut self) {
            let Ok(mut ids) = self.state.ids.lock() else {
                // TODO: Figure out whether this could happen. It shouldn't happen, but if it does,
                // should we ignore poisoned locks?
                error!("Failed to lock ids for id {}", self.id);
                return;
            };

            ids[self.id] = false;
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc;

    use tokio::time::{sleep, timeout, Instant};

    use super::*;

    #[tokio::test]
    async fn a_request_that_ends_early_keeps_the_slot_until_the_build_ends() {
        let state = BuildState::with_concurrency(1);
        let permit = concurrent::Permit::acquire(state.clone()).await.unwrap();
        let (finish, finished) = mpsc::channel::<()>();

        // The request ends while its build is still running
        let request = run_holding(permit, move |_| finished.recv().ok());
        assert!(timeout(Duration::from_millis(50), request).await.is_err());
        sleep(Duration::from_millis(50)).await;
        assert_eq!(state.sem.available_permits(), 0);

        finish.send(()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        while state.sem.available_permits() == 0 && Instant::now() < deadline {
            sleep(Duration::from_millis(10)).await;
        }
        assert_eq!(state.sem.available_permits(), 1);
        let next = concurrent::Permit::acquire(state).await.unwrap();
        assert_eq!(next.id(), 0);
    }

    #[tokio::test]
    async fn a_build_within_the_limit_returns_its_output_and_frees_the_slot() {
        let state = BuildState::with_concurrency(1);
        let permit = concurrent::Permit::acquire(state.clone()).await.unwrap();
        assert_eq!(run_holding(permit, |id| id).await.unwrap(), 0);
        assert_eq!(state.sem.available_permits(), 1);
    }
}
