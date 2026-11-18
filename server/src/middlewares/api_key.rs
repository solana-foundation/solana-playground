use std::{fmt, sync::Arc};

use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};

/// The header a caller proves it holds a key with.
pub const API_KEY_HEADER: &str = "x-api-key";

/// The keys a request to the guarded routes may carry, one per client of the
/// server, so each can be rotated or revoked without touching the others.
///
/// `Debug` never prints a value: `main` logs the whole [`Config`] at start-up.
///
/// [`Config`]: crate::config::Config
#[derive(Clone)]
pub struct ApiKeys(Arc<[String]>);

impl ApiKeys {
    /// The keys of `list`, comma-separated, and `key`, a single key, or `None`
    /// when neither holds one.
    ///
    /// Each key is trimmed, since a trailing newline from a secret file would
    /// never match a header, and an empty one is dropped, since it would admit
    /// any caller that sends an empty header.
    pub fn new(list: Option<&str>, key: Option<&str>) -> Option<Self> {
        let keys: Vec<String> = list
            .into_iter()
            .flat_map(|list| list.split(','))
            .chain(key)
            .map(str::trim)
            .filter(|key| !key.is_empty())
            .map(ToOwned::to_owned)
            .collect();
        (!keys.is_empty()).then(|| Self(keys.into()))
    }

    /// How many keys are accepted.
    pub fn len(&self) -> usize {
        self.0.len()
    }

    /// Whether `given` is one of the keys. Every key is compared, whichever
    /// matches, so the time taken does not tell a caller which one it was.
    fn contains(&self, given: &[u8]) -> bool {
        self.0.iter().fold(false, |found, key| {
            found | constant_time_eq(given, key.as_bytes())
        })
    }
}

impl fmt::Debug for ApiKeys {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "ApiKeys(<{} redacted>)", self.len())
    }
}

/// Refuse a request whose `x-api-key` header is none of `keys`, when any are
/// set.
///
/// Off by default: with no key configured every request passes, as before the
/// check existed. Set `PG_API_KEYS` (or `PG_API_KEY`) to make the routes it
/// guards answer only a caller holding a key, such as the client deployment's
/// build proxy.
pub async fn require_api_key(
    State(keys): State<Option<ApiKeys>>,
    req: Request,
    next: Next,
) -> Response {
    let Some(keys) = keys else {
        return next.run(req).await;
    };

    let given = req
        .headers()
        .get(API_KEY_HEADER)
        .map(|v| v.as_bytes())
        .unwrap_or_default();
    if keys.contains(given) {
        next.run(req).await
    } else {
        (StatusCode::UNAUTHORIZED, "Missing or invalid API key").into_response()
    }
}

/// Compare without returning early on the first differing byte, so the time
/// taken does not tell a caller how much of a guess was right. The length is
/// not secret.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

#[cfg(test)]
mod tests {
    use axum::{body::Body, middleware, routing::get, Router};
    use tower::ServiceExt;

    use super::*;

    fn app(list: Option<&str>) -> Router {
        let keys = ApiKeys::new(list, None);
        let guarded = Router::new()
            .route("/build", get(|| async { "built" }))
            .layer(middleware::from_fn_with_state(keys, require_api_key));
        Router::new()
            .merge(guarded)
            .route("/open", get(|| async { "open" }))
    }

    async fn status(app: Router, path: &str, header: Option<&str>) -> StatusCode {
        let mut req = Request::builder().uri(path);
        if let Some(h) = header {
            req = req.header(API_KEY_HEADER, h);
        }
        app.oneshot(req.body(Body::empty()).unwrap())
            .await
            .unwrap()
            .status()
    }

    #[tokio::test]
    async fn matching_key_passes() {
        assert_eq!(
            status(app(Some("s3cret")), "/build", Some("s3cret")).await,
            StatusCode::OK
        );
    }

    #[tokio::test]
    async fn every_listed_key_passes() {
        for key in ["playground", "explorer", "cli"] {
            assert_eq!(
                status(app(Some("playground,explorer,cli")), "/build", Some(key)).await,
                StatusCode::OK,
                "{key}"
            );
        }
    }

    #[tokio::test]
    async fn missing_key_is_401() {
        assert_eq!(
            status(app(Some("s3cret,other")), "/build", None).await,
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn wrong_key_is_401() {
        assert_eq!(
            status(app(Some("s3cret,other")), "/build", Some("s3creu")).await,
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn wrong_length_is_401() {
        assert_eq!(
            status(app(Some("s3cret")), "/build", Some("s3cret-and-more")).await,
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn the_whole_list_is_not_a_key() {
        assert_eq!(
            status(app(Some("s3cret,other")), "/build", Some("s3cret,other")).await,
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn a_removed_key_is_401_and_the_others_still_pass() {
        let after = || app(Some("playground,cli"));
        assert_eq!(
            status(after(), "/build", Some("explorer")).await,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            status(after(), "/build", Some("playground")).await,
            StatusCode::OK
        );
        assert_eq!(status(after(), "/build", Some("cli")).await, StatusCode::OK);
    }

    #[tokio::test]
    async fn no_key_configured_passes() {
        assert_eq!(status(app(None), "/build", None).await, StatusCode::OK);
    }

    #[test]
    fn empty_keys_count_as_unset() {
        assert!(ApiKeys::new(None, None).is_none());
        assert!(ApiKeys::new(Some(""), Some("")).is_none());
        assert!(ApiKeys::new(Some(" , \n,"), Some(" \n")).is_none());
    }

    #[test]
    fn empty_entries_are_dropped() {
        let keys = ApiKeys::new(Some(",s3cret,, other ,"), None).unwrap();
        assert_eq!(keys.len(), 2);
        assert!(keys.contains(b"s3cret"));
        assert!(keys.contains(b"other"));
        assert!(!keys.contains(b""));
    }

    #[test]
    fn the_single_key_joins_the_list() {
        let keys = ApiKeys::new(Some("playground"), Some("legacy")).unwrap();
        assert_eq!(keys.len(), 2);
        assert!(keys.contains(b"playground"));
        assert!(keys.contains(b"legacy"));

        let alone = ApiKeys::new(None, Some("legacy")).unwrap();
        assert!(alone.contains(b"legacy"));
    }

    #[test]
    fn the_single_key_is_not_split() {
        let keys = ApiKeys::new(None, Some("a,b")).unwrap();
        assert!(keys.contains(b"a,b"));
        assert!(!keys.contains(b"a"));
    }

    #[tokio::test]
    async fn a_trailing_newline_is_not_part_of_the_key() {
        let keys = ApiKeys::new(Some("s3cret\n"), Some("other\n"));
        let guarded = Router::new()
            .route("/build", get(|| async { "built" }))
            .layer(middleware::from_fn_with_state(keys, require_api_key));
        assert_eq!(
            status(guarded.clone(), "/build", Some("s3cret")).await,
            StatusCode::OK
        );
        assert_eq!(
            status(guarded, "/build", Some("other")).await,
            StatusCode::OK
        );
    }

    #[tokio::test]
    async fn unguarded_route_is_open() {
        assert_eq!(
            status(app(Some("s3cret")), "/open", None).await,
            StatusCode::OK
        );
    }

    #[test]
    fn debug_redacts_every_key() {
        let printed = format!("{:?}", ApiKeys::new(Some("s3cret,other"), Some("legacy")));
        for key in ["s3cret", "other", "legacy"] {
            assert!(!printed.contains(key), "{printed}");
        }
        assert!(printed.contains("3 redacted"), "{printed}");
    }
}
