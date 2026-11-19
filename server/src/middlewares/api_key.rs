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
    /// The keys of `list` (`PG_API_KEYS`), comma-separated, or, only when
    /// `list` holds none, `key` (`PG_API_KEY`), a single key; `None` when
    /// both are unset.
    ///
    /// The two never combine: a key left in `key` after the list is set would
    /// survive removing its entry from the list, and revoking a client would
    /// not revoke it.
    ///
    /// Fails when either is set but no key comes out, rather than leaving the
    /// routes open: whoever set one meant them guarded. Fails too on a key
    /// with a space or a character outside visible ASCII, which a client
    /// could never send in a header, such as a list separated by newlines.
    /// No error names a key.
    pub fn new(list: Option<&str>, key: Option<&str>) -> Result<Option<Self>, String> {
        let entries = list.into_iter().flat_map(|list| list.split(','));
        let keys = match Self::from_entries(entries, "PG_API_KEYS")? {
            Some(keys) => Some(keys),
            None => Self::from_entries(key, "PG_API_KEY")?,
        };
        if keys.is_none() && (list.is_some() || key.is_some()) {
            return Err("PG_API_KEYS or PG_API_KEY is set but holds no key; \
                unset both to leave the build, deploy and unstable routes open"
                .into());
        }
        Ok(keys)
    }

    /// Each entry is trimmed, since a trailing newline from a secret file
    /// would never match a header, and an empty one is dropped, since it would
    /// admit any caller that sends an empty header.
    fn from_entries<'a>(
        entries: impl IntoIterator<Item = &'a str>,
        name: &str,
    ) -> Result<Option<Self>, String> {
        let mut keys = Vec::new();
        for (n, entry) in entries.into_iter().enumerate() {
            let key = entry.trim();
            if key.is_empty() {
                continue;
            }
            if !key.bytes().all(|byte| byte.is_ascii_graphic()) {
                return Err(format!(
                    "entry {} of {name} holds a space or a character outside \
                     visible ASCII, which no request can send",
                    n + 1
                ));
            }
            keys.push(key.to_owned());
        }
        Ok((!keys.is_empty()).then(|| Self(keys.into())))
    }

    /// How many keys are accepted; never zero, since [`ApiKeys::new`] gives
    /// `None` rather than an empty list.
    pub fn len(&self) -> usize {
        self.0.len()
    }

    /// Whether `given` is one of the keys. Every key is compared, whichever
    /// matches, so the time taken does not tell a caller which key matched.
    /// It can tell how many keys share the length of what was sent; keys of
    /// one length, as `openssl rand -hex 32` makes, leave nothing to learn.
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

    fn keys(list: Option<&str>, key: Option<&str>) -> ApiKeys {
        ApiKeys::new(list, key).unwrap().unwrap()
    }

    fn app(list: Option<&str>) -> Router {
        let keys = list.map(|list| keys(Some(list), None));
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
    fn neither_set_is_unset() {
        assert!(ApiKeys::new(None, None).unwrap().is_none());
    }

    #[test]
    fn a_variable_set_without_a_key_fails() {
        for (list, key) in [
            (Some(""), None),
            (None, Some("")),
            (Some(""), Some("")),
            (Some(" , \n,"), Some(" \n")),
        ] {
            assert!(ApiKeys::new(list, key).is_err(), "{list:?} {key:?}");
        }
    }

    #[test]
    fn a_key_no_request_can_send_fails() {
        for (list, key) in [
            (Some("s3cret\nother"), None),
            (Some("s3cret,two words"), None),
            (None, Some("s3cr\u{e9}t")),
        ] {
            let error = ApiKeys::new(list, key).expect_err("an error");
            for key in ["s3cret", "other", "two", "words", "s3cr"] {
                assert!(!error.contains(key), "{error}");
            }
        }
    }

    #[test]
    fn empty_entries_are_dropped() {
        let keys = keys(Some(",s3cret,, other ,"), None);
        assert_eq!(keys.len(), 2);
        assert!(keys.contains(b"s3cret"));
        assert!(keys.contains(b"other"));
        assert!(!keys.contains(b""));
    }

    #[test]
    fn the_single_key_is_ignored_once_the_list_is_set() {
        let keys = keys(Some("playground,explorer"), Some("legacy"));
        assert_eq!(keys.len(), 2);
        assert!(keys.contains(b"playground"));
        assert!(!keys.contains(b"legacy"));
    }

    #[test]
    fn the_single_key_is_used_when_the_list_holds_none() {
        for list in [None, Some(""), Some(" , \n")] {
            let keys = keys(list, Some("legacy"));
            assert_eq!(keys.len(), 1, "{list:?}");
            assert!(keys.contains(b"legacy"), "{list:?}");
        }
    }

    #[test]
    fn a_key_removed_from_the_list_is_401_even_if_it_is_the_single_key() {
        let keys = keys(Some("explorer"), Some("playground"));
        assert!(!keys.contains(b"playground"));
        assert!(keys.contains(b"explorer"));
    }

    #[test]
    fn the_single_key_is_not_split() {
        let keys = keys(None, Some("a,b"));
        assert!(keys.contains(b"a,b"));
        assert!(!keys.contains(b"a"));
    }

    #[tokio::test]
    async fn a_trailing_newline_is_not_part_of_the_key() {
        for keys in [keys(Some("s3cret\n"), None), keys(None, Some("s3cret\r\n"))] {
            let guarded = Router::new()
                .route("/build", get(|| async { "built" }))
                .layer(middleware::from_fn_with_state(Some(keys), require_api_key));
            assert_eq!(
                status(guarded, "/build", Some("s3cret")).await,
                StatusCode::OK
            );
        }
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
        let printed = format!("{:?}", keys(Some("s3cret,other"), None));
        for key in ["s3cret", "other"] {
            assert!(!printed.contains(key), "{printed}");
        }
        assert!(printed.contains("2 redacted"), "{printed}");

        let printed = format!("{:?}", keys(None, Some("legacy")));
        assert!(!printed.contains("legacy"), "{printed}");
        assert!(printed.contains("1 redacted"), "{printed}");
    }
}
