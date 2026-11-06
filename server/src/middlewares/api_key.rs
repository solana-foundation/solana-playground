use std::fmt;

use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};

/// The header a caller proves it holds the key with.
pub const API_KEY_HEADER: &str = "x-api-key";

/// A key every request to the guarded routes must carry.
///
/// `Debug` never prints the value: `main` logs the whole [`Config`] at start-up.
///
/// [`Config`]: crate::config::Config
#[derive(Clone)]
pub struct ApiKey(String);

impl ApiKey {
    /// A key from its value, trimmed, or `None` for an empty one, which would
    /// admit any caller that sends an empty header.
    pub fn new(value: String) -> Option<Self> {
        // A trailing newline from a secret file would never match a header
        let value = value.trim();
        (!value.is_empty()).then(|| Self(value.to_owned()))
    }
}

impl fmt::Debug for ApiKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ApiKey(<redacted>)")
    }
}

/// Refuse a request whose `x-api-key` header is not `key`, when one is set.
///
/// Off by default: with no key configured every request passes, as before the
/// check existed. Set `PG_API_KEY` to make the routes it guards answer only a
/// caller holding the key, such as the client deployment's build proxy.
pub async fn require_api_key(
    State(key): State<Option<ApiKey>>,
    req: Request,
    next: Next,
) -> Response {
    let Some(key) = key else {
        return next.run(req).await;
    };

    let given = req
        .headers()
        .get(API_KEY_HEADER)
        .map(|v| v.as_bytes())
        .unwrap_or_default();
    if constant_time_eq(given, key.0.as_bytes()) {
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

    fn app(key: Option<&str>) -> Router {
        let key = key.and_then(|k| ApiKey::new(k.to_owned()));
        let guarded = Router::new()
            .route("/build", get(|| async { "built" }))
            .layer(middleware::from_fn_with_state(key, require_api_key));
        Router::new()
            .merge(guarded)
            .route("/share", get(|| async { "shared" }))
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
    async fn missing_key_is_401() {
        assert_eq!(
            status(app(Some("s3cret")), "/build", None).await,
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn wrong_key_is_401() {
        assert_eq!(
            status(app(Some("s3cret")), "/build", Some("s3creu")).await,
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
    async fn no_key_configured_passes() {
        assert_eq!(status(app(None), "/build", None).await, StatusCode::OK);
    }

    #[tokio::test]
    async fn empty_key_counts_as_unset() {
        assert!(ApiKey::new(String::new()).is_none());
        assert!(ApiKey::new(" \n".to_owned()).is_none());
    }

    #[tokio::test]
    async fn a_trailing_newline_is_not_part_of_the_key() {
        let key = ApiKey::new("s3cret\n".to_owned());
        let guarded = Router::new()
            .route("/build", get(|| async { "built" }))
            .layer(middleware::from_fn_with_state(key, require_api_key));
        assert_eq!(
            status(guarded, "/build", Some("s3cret")).await,
            StatusCode::OK
        );
    }

    #[tokio::test]
    async fn share_route_is_open() {
        assert_eq!(
            status(app(Some("s3cret")), "/share", None).await,
            StatusCode::OK
        );
    }

    #[test]
    fn debug_redacts_key() {
        let printed = format!("{:?}", ApiKey::new("s3cret".to_owned()));
        assert!(!printed.contains("s3cret"), "{printed}");
    }
}
