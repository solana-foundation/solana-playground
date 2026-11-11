use std::sync::{Arc, Mutex};

use anyhow::anyhow;
use axum::{
    extract::{Json, State},
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use solpg_server::{program, utils::Files, Result};
use tokio::{sync::Semaphore, task};
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

impl BuildState {
    /// Create a new value with the maximum amount of concurrent builds.
    pub fn new(concurrency: usize) -> Self {
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
    let concurrency_id = permit.id();

    // Spawn a blocking `tokio::task` to avoid blocking the thread
    let (build_result, uuid) =
        task::spawn_blocking(move || (program::build(concurrency_id, &uuid, &payload.files), uuid))
            .await
            .map_err(|e| anyhow!("Failed to run `spawn_blocking`: {e}"))?;
    let stderr = build_result?;

    Ok(Json(BuildResponse {
        stderr,
        uuid: if respond_with_uuid { Some(uuid) } else { None },
        idl: None,
    }))
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
