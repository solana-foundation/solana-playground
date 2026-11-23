mod config;
mod middlewares;
mod routes;
#[cfg(feature = "unstable")]
mod setup;

use std::net::{Ipv4Addr, SocketAddr};

use anyhow::Result;
use axum::{
    middleware,
    routing::{get, post},
    Router,
};
use solpg_server::log::{self, error, info};
use tokio::net::TcpListener;

use self::{config::Config, middlewares::*, routes::*};

/// The server's routes and middleware, as `main` serves them. Separate so a
/// test can check which routes the API keys guard.
fn app(config: Config) -> Router {
    // Off unless `PG_API_KEYS` or `PG_API_KEY` is set. Guards what costs the
    // server work or serves a build's output
    let api_key = middleware::from_fn_with_state(config.api_keys, require_api_key);

    let build_routes = Router::new()
        .route(
            "/build",
            post(build).with_state(BuildState::new(
                config.build_concurrency,
                config.build_queue,
            )),
        )
        .route("/deploy/{uuid}", get(deploy))
        .layer(api_key.clone());

    let unstable_routes = if cfg!(feature = "unstable") {
        let build_concurrency = config.unstable_build.limits.route.concurrency;
        Router::new()
            .route(
                "/build",
                post(unstable::build)
                    .with_state(unstable::BuildState::new(config.unstable_build))
                    .layer(concurrency_limit(build_concurrency)),
            )
            .route("/deploy/{uuid}", get(unstable::deploy))
            .layer(api_key)
    } else {
        Router::new()
    };

    Router::new()
        .merge(build_routes)
        .nest("/unstable", unstable_routes)
        .layer(compression())
        .layer(payload_limit(config.payload_limit))
        .layer(cors(config.client_urls))
        .layer(middleware::from_fn(log))
}

#[tokio::main]
async fn main() -> Result<()> {
    let config = Config::from_env()?;
    log::init(config.verbose);
    info!("Config loaded: {config:#?}");

    #[cfg(feature = "unstable")]
    setup::setup().await?;

    match &config.api_keys {
        Some(keys) => info!(
            "API key required on build, deploy and unstable routes; {} accepted",
            keys.len()
        ),
        // `error!`, the one level a server without `RUST_LOG` prints, as on App
        // Engine: an open server must show in its logs
        None => error!(
            "Neither PG_API_KEYS nor PG_API_KEY is set: build, deploy and unstable routes are open"
        ),
    }
    let port = config.port;
    let app = app(config);

    let addr = SocketAddr::from((Ipv4Addr::UNSPECIFIED, port));
    let listener = TcpListener::bind(addr).await?;
    info!("Listening on {addr}");

    axum::serve(listener, app).await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use tower::ServiceExt;

    use super::*;

    fn guarded_app() -> Router {
        let mut config = Config::from_env().unwrap();
        config.api_keys = ApiKeys::new(Some("s3cret,other"), None).unwrap();
        app(config)
    }

    async fn status(method: &str, path: &str, key: Option<&str>) -> StatusCode {
        let mut req = Request::builder().method(method).uri(path);
        if let Some(key) = key {
            req = req.header("x-api-key", key);
        }
        guarded_app()
            .oneshot(req.body(Body::empty()).unwrap())
            .await
            .unwrap()
            .status()
    }

    #[tokio::test]
    async fn build_and_deploy_need_the_key() {
        assert_eq!(
            status("POST", "/build", None).await,
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            status("GET", "/deploy/0b9f4d3e-6c1a-4f7e-9a2b-3c4d5e6f7a8b", None).await,
            StatusCode::UNAUTHORIZED
        );
    }

    #[tokio::test]
    async fn every_key_lets_a_build_through_to_its_handler() {
        // An empty body fails in the handler's extractor, past the key check
        for key in ["s3cret", "other"] {
            assert_ne!(
                status("POST", "/build", Some(key)).await,
                StatusCode::UNAUTHORIZED,
                "{key}"
            );
        }
    }

    #[cfg(feature = "unstable")]
    #[tokio::test]
    async fn unstable_routes_need_the_key() {
        for (method, path) in [
            ("POST", "/unstable/build"),
            (
                "GET",
                "/unstable/deploy/0b9f4d3e-6c1a-4f7e-9a2b-3c4d5e6f7a8b",
            ),
            ("POST", "/unstable/bundle"),
        ] {
            assert_eq!(
                status(method, path, None).await,
                StatusCode::UNAUTHORIZED,
                "{path}"
            );
        }
    }
}
