use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};

use anyhow::anyhow;
use axum::{
    extract::{Json, State},
    response::IntoResponse,
};
use serde::{Deserialize, Serialize};
use solpg_server::{program, utils::Files, Error, Result};
use tokio::{
    sync::{Semaphore, TryAcquireError},
    task,
    time::{interval, timeout, timeout_at, Duration, Instant},
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
    /// How many requests wait for a slot right now, counted by [`concurrent::Waiting`]
    waiting: Arc<AtomicUsize>,
    /// How many requests may wait, and for how long
    queue: QueueLimits,
}

/// How many requests may wait for a build slot, and for how long.
#[derive(Clone, Copy, Debug)]
pub struct QueueLimits {
    /// Requests allowed to wait for a slot; one past it is answered `503` at once
    pub max_waiting: usize,
    /// How long one request waits for a slot before it is answered `503`
    pub max_wait: Duration,
}

/// Default for [`QueueLimits::max_waiting`]: two rounds of the 3 builds `app.yaml` runs at once.
pub const DEFAULT_MAX_WAITING: usize = 6;

/// Default for [`QueueLimits::max_wait`], in seconds.
///
/// A request that waited this long has [`REQUEST_TIME_LIMIT`] minus this left to build in, 220 s
/// with the defaults, so the wait never starves the build and the sum stays inside the proxy's
/// `maxDuration`.
pub const DEFAULT_MAX_WAIT_SECS: u64 = 60;

/// How long the server spends on one build request, from its arrival: the wait for a slot and the
/// build itself.
///
/// It must stay inside the `maxDuration` of `api/build-server.mjs` in `client-v2/vercel.json`
/// (300 s), the proxy in front of this route; past that the proxy has already answered the user
/// with a failure, so a build still running would hold its slot for nothing. The 20 s left over
/// cover the transfer through the proxy.
///
/// The wait is further bounded by [`QueueLimits::max_wait`], so a request that gets a slot has at
/// least this limit minus that wait left to build in; one that does not is answered `503` with
/// `Retry-After` long before the proxy gives up.
const REQUEST_TIME_LIMIT: Duration = Duration::from_secs(280);

/// How often old build directories are looked for
const BUILD_DIR_CLEANUP_INTERVAL: Duration = Duration::from_secs(60 * 60);

impl BuildState {
    /// Create a new value with the maximum amount of concurrent builds, and start removing old
    /// build directories in the background.
    ///
    /// Must be called inside a Tokio runtime.
    pub fn new(concurrency: usize, queue: QueueLimits) -> Self {
        tokio::spawn(async {
            let mut ticks = interval(BUILD_DIR_CLEANUP_INTERVAL);
            loop {
                ticks.tick().await;
                if let Err(e) = task::spawn_blocking(program::remove_old_build_dirs).await {
                    crate::log::error!("Failed to remove old build directories: {e}");
                }
            }
        });
        Self::with_limits(concurrency, queue)
    }

    /// Create a new value with the maximum amount of concurrent builds and the queue's limits.
    fn with_limits(concurrency: usize, queue: QueueLimits) -> Self {
        Self {
            sem: Arc::new(Semaphore::new(concurrency)),
            ids: Arc::new(Mutex::new(vec![false; concurrency])),
            waiting: Arc::new(AtomicUsize::new(0)),
            queue,
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

    let deadline = Instant::now() + REQUEST_TIME_LIMIT;

    // Only permit a certain number of builds concurrently. The wait is bounded twice: by the
    // queue's own limits inside `acquire`, and by the request's deadline here
    let permit = timeout_at(deadline, concurrent::Permit::acquire(state))
        .await
        .map_err(|_| Error::busy())??;
    let (build_result, uuid) = run_holding(permit, move |concurrency_id| {
        let time_limit = deadline.saturating_duration_since(Instant::now());
        (
            program::build(concurrency_id, &uuid, &payload.files, time_limit),
            uuid,
        )
    })
    .await?;
    let stderr = build_result?;

    Ok(Json(BuildResponse {
        stderr,
        uuid: if respond_with_uuid { Some(uuid) } else { None },
        idl: None,
    }))
}

/// Run `f` with the permit's id on the blocking pool, so it does not block an async worker.
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
        /// A free slot is taken without waiting. With none free the request joins the queue,
        /// unless [`QueueLimits::max_waiting`] requests already wait, which is
        /// [`Error::Busy`] at once. A request that waits [`QueueLimits::max_wait`] without a slot
        /// is [`Error::Busy`] too, and holds no slot.
        ///
        /// # Note
        ///
        /// This function takes ownership of [`BuildState`], even though it doesn't need to, in
        /// order to help make sure the ids [`Mutex`] doesn't get used anywhere else. This is done
        /// to limit the usage of `state.ids` and make sure it never gets poisoned.
        pub async fn acquire(state: BuildState) -> Result<Self> {
            let permit = match state.sem.clone().try_acquire_owned() {
                Ok(permit) => permit,
                Err(TryAcquireError::NoPermits) => {
                    // Counted until the wait ends, whichever way: a slot, the limit, or the
                    // request dropped by the caller leaving
                    let _waiting = Waiting::enter(&state)?;
                    timeout(state.queue.max_wait, state.sem.clone().acquire_owned())
                        .await
                        .map_err(|_| Error::busy())?
                        .map_err(|e| anyhow!("Failed to acquire `Semaphore`: {e}"))?
                }
                Err(TryAcquireError::Closed) => {
                    return Err(anyhow!("Failed to acquire `Semaphore`: closed").into())
                }
            };

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

    /// A request's place in the queue for a slot, counted while it lives.
    ///
    /// The count is released on drop, so a request that times out, or whose caller leaves, never
    /// leaks it.
    struct Waiting(Arc<AtomicUsize>);

    impl Waiting {
        /// Join the queue, or [`Error::Busy`] when [`QueueLimits::max_waiting`] already wait.
        fn enter(state: &BuildState) -> Result<Self> {
            state
                .waiting
                .fetch_update(Ordering::AcqRel, Ordering::Acquire, |waiting| {
                    (waiting < state.queue.max_waiting).then_some(waiting + 1)
                })
                .map_err(|_| Error::busy())?;
            Ok(Self(Arc::clone(&state.waiting)))
        }
    }

    impl Drop for Waiting {
        fn drop(&mut self) {
            self.0.fetch_sub(1, Ordering::AcqRel);
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

    /// Limits that never get in the way of a test about something else
    const ROOMY: QueueLimits = QueueLimits {
        max_waiting: 8,
        max_wait: Duration::from_secs(30),
    };

    fn is_busy<T>(result: &Result<T>) -> bool {
        matches!(result, Err(Error::Busy { .. }))
    }

    #[tokio::test]
    async fn a_request_that_ends_early_keeps_the_slot_until_the_build_ends() {
        let state = BuildState::with_limits(1, ROOMY);
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
        let state = BuildState::with_limits(1, ROOMY);
        let permit = concurrent::Permit::acquire(state.clone()).await.unwrap();
        assert_eq!(run_holding(permit, |id| id).await.unwrap(), 0);
        assert_eq!(state.sem.available_permits(), 1);
    }

    #[tokio::test]
    async fn a_build_that_fails_or_panics_frees_the_slot() {
        let state = BuildState::with_limits(1, ROOMY);
        let permit = concurrent::Permit::acquire(state.clone()).await.unwrap();
        let timed_out = run_holding(permit, |_| Err::<(), _>("Build timed out"));
        assert!(timed_out.await.unwrap().is_err());
        assert_eq!(state.sem.available_permits(), 1);

        let permit = concurrent::Permit::acquire(state.clone()).await.unwrap();
        assert!(run_holding(permit, |_| panic!("build panicked"))
            .await
            .is_err());
        assert_eq!(state.sem.available_permits(), 1);
    }

    #[tokio::test]
    async fn a_free_slot_is_taken_without_waiting() {
        let state = BuildState::with_limits(
            1,
            QueueLimits {
                max_waiting: 0,
                max_wait: Duration::ZERO,
            },
        );
        let permit = concurrent::Permit::acquire(state.clone()).await;
        assert!(permit.is_ok());
        assert_eq!(state.waiting.load(Ordering::Acquire), 0);
    }

    #[tokio::test]
    async fn a_request_past_the_queue_is_refused_at_once() {
        let state = BuildState::with_limits(
            1,
            QueueLimits {
                max_waiting: 1,
                max_wait: Duration::from_secs(30),
            },
        );
        let holder = concurrent::Permit::acquire(state.clone()).await.unwrap();
        let waiter = tokio::spawn(concurrent::Permit::acquire(state.clone()));
        while state.waiting.load(Ordering::Acquire) < 1 {
            sleep(Duration::from_millis(5)).await;
        }

        // The queue is full: the answer comes back long before `max_wait`
        let refused = timeout(
            Duration::from_secs(2),
            concurrent::Permit::acquire(state.clone()),
        )
        .await
        .expect("a full queue must not make the request wait");
        assert!(is_busy(&refused));
        assert_eq!(state.waiting.load(Ordering::Acquire), 1);

        // The one waiting still gets the slot when it frees
        drop(holder);
        let next = waiter.await.unwrap().unwrap();
        assert_eq!(next.id(), 0);
        assert_eq!(state.waiting.load(Ordering::Acquire), 0);
    }

    #[tokio::test]
    async fn a_request_that_waits_too_long_is_refused_and_takes_no_slot() {
        let state = BuildState::with_limits(
            1,
            QueueLimits {
                max_waiting: 4,
                max_wait: Duration::from_millis(50),
            },
        );
        let holder = concurrent::Permit::acquire(state.clone()).await.unwrap();

        let refused = concurrent::Permit::acquire(state.clone()).await;
        assert!(is_busy(&refused));
        // Neither the waiter count nor a permit leaked
        assert_eq!(state.waiting.load(Ordering::Acquire), 0);
        assert_eq!(state.sem.available_permits(), 0);

        drop(holder);
        assert_eq!(state.sem.available_permits(), 1);
        let next = concurrent::Permit::acquire(state.clone()).await.unwrap();
        assert_eq!(next.id(), 0);
    }

    #[tokio::test]
    async fn a_request_dropped_while_it_waits_leaves_the_queue() {
        let state = BuildState::with_limits(
            1,
            QueueLimits {
                max_waiting: 4,
                max_wait: Duration::from_secs(30),
            },
        );
        let holder = concurrent::Permit::acquire(state.clone()).await.unwrap();
        let waiter = tokio::spawn(concurrent::Permit::acquire(state.clone()));
        while state.waiting.load(Ordering::Acquire) < 1 {
            sleep(Duration::from_millis(5)).await;
        }

        waiter.abort();
        let _ = waiter.await;
        assert_eq!(state.waiting.load(Ordering::Acquire), 0);

        drop(holder);
        assert_eq!(state.sem.available_permits(), 1);
    }
}
