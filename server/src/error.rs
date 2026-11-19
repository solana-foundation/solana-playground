use axum::{
    http::{header::RETRY_AFTER, StatusCode},
    response::{IntoResponse, Response},
};

use crate::log::{error, warn};

/// What a busy server tells the client to wait before it retries, in seconds
const BUSY_RETRY_AFTER_SECS: u64 = 30;

/// Application result type that can be used in API handler functions
pub type Result<T> = core::result::Result<T, Error>;

/// Application error type that can be returned from [`Result`] in API handler functions.
#[derive(thiserror::Error, Debug)]
pub enum Error {
    /// The server has no capacity for the request right now; the client may retry
    #[error("The build server is busy, try again in {retry_after_secs} seconds")]
    Busy {
        /// Seconds the client is told to wait, as `Retry-After`
        retry_after_secs: u64,
    },
    /// Catch-all for all remaining errors
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

impl Error {
    /// The server has no capacity for the request; see [`Error::Busy`].
    pub fn busy() -> Self {
        Error::Busy {
            retry_after_secs: BUSY_RETRY_AFTER_SECS,
        }
    }

    /// Map the error type to the corresponding HTTP status codes.
    fn status_code(&self) -> StatusCode {
        match self {
            Error::Busy { .. } => StatusCode::SERVICE_UNAVAILABLE,
            Error::Other(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
}

/// Support converting the errors to an [`axum`] response.
impl IntoResponse for Error {
    fn into_response(self) -> Response {
        // Log the error
        match &self {
            Error::Busy { .. } => warn!("{self}"),
            Error::Other(e) => error!("Other error: {e}"),
        }

        let status = self.status_code();
        let message = self.to_string();
        match self {
            Error::Busy { retry_after_secs } => (
                status,
                [(RETRY_AFTER, retry_after_secs.to_string())],
                message,
            )
                .into_response(),
            Error::Other(_) => (status, message).into_response(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_busy_server_answers_503_with_retry_after() {
        let response = Error::busy().into_response();
        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let retry_after = response.headers().get(RETRY_AFTER).unwrap();
        assert_eq!(retry_after.to_str().unwrap(), "30");
    }

    #[test]
    fn any_other_error_is_a_500_without_retry_after() {
        let response = Error::Other(anyhow::anyhow!("boom")).into_response();
        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert!(response.headers().get(RETRY_AFTER).is_none());
    }
}
