use std::{str::FromStr, time::Duration};

use anyhow::{anyhow, Result};
use dotenv::dotenv;
use solpg_server::SandboxLimits;

use crate::{
    middlewares::ApiKeys,
    routes::{QueueLimits, DEFAULT_MAX_WAITING, DEFAULT_MAX_WAIT_SECS},
};

/// Server configuration
#[derive(Debug)]
pub struct Config {
    /// Client URLs to allow requests from
    pub client_urls: Vec<String>,
    /// Port to listen from
    pub port: u16,
    /// Request payload size limit in bytes
    pub payload_limit: usize,
    /// Whether logs should be verbose
    pub verbose: bool,
    /// Maximum amount of concurrent builds
    pub build_concurrency: usize,
    /// How many build requests may wait for a slot, and for how long
    pub build_queue: QueueLimits,
    /// Keys the build, deploy and unstable routes accept in `x-api-key`, if
    /// any: `PG_API_KEYS`, comma-separated, one per client, or, only when it
    /// holds none, `PG_API_KEY`, a single key, which deployments set before
    /// the list existed
    pub api_keys: Option<ApiKeys>,
    /// Unstable build configuration
    pub unstable_build: BuildConfig,
    /// Unstable bundle configuration
    pub unstable_bundle: BundleConfig,
}

impl Config {
    /// Create [`Config`] from the environment variables.
    ///
    /// `.env` file is supported.
    pub fn from_env() -> Result<Config> {
        dotenv().ok();

        Ok(Config {
            client_urls: get_env::<String>(
                "CLIENT_URLS",
                "http://localhost,http://127.0.0.1,https://beta.solpg.io,https://playground.solana.com,https://solana-playground-two.vercel.app",
            )
            .split(',')
            .map(str::trim)
            .map(ToOwned::to_owned)
            .collect(),
            port: get_env("PORT", 8080u16),
            payload_limit: get_env("PAYLOAD_LIMIT", 1024usize * 1024),
            verbose: get_env("VERBOSE", false),
            build_concurrency: get_env("BUILD_CONCURRENCY", 16usize),
            build_queue: QueueLimits {
                max_waiting: get_env("BUILD_QUEUE_LIMIT", DEFAULT_MAX_WAITING),
                max_wait: Duration::from_secs(get_env(
                    "BUILD_QUEUE_WAIT_SECS",
                    DEFAULT_MAX_WAIT_SECS,
                )),
            },
            api_keys: api_keys_from(read_env)?,
            unstable_build: BuildConfig {
                limits: Limits {
                    route: RouteLimits {
                        concurrency: get_env("UNSTABLE_BUILD_CONCURRENCY_LIMIT", 16usize),
                    },
                    sandbox: SandboxLimits {
                        cpu: Some(get_env("UNSTABLE_BUILD_CPU_LIMIT", 1usize)),
                        memory: Some(get_env(
                            "UNSTABLE_BUILD_MEMORY_LIMIT",
                            2usize * 1024 * 1024 * 1024, // 2 GiB
                        )),
                        process: Some(get_env("UNSTABLE_BUILD_PROCESS_LIMIT", 64usize)),
                        storage: get_env_raw("UNSTABLE_BUILD_STORAGE_LIMIT")
                            .map(|v| v.parse())
                            .transpose()?,
                        timeout: Some(get_env("UNSTABLE_BUILD_TIMEOUT_LIMIT", 30u64)),
                    },
                },
            },
            unstable_bundle: BundleConfig {
                // TODO: Re-evaulate defaults before stabilization
                limits: Limits {
                    route: RouteLimits {
                        concurrency: get_env("UNSTABLE_BUNDLE_CONCURRENCY_LIMIT", 16usize),
                    },
                    sandbox: SandboxLimits {
                        // Diminishing returns after 4
                        cpu: Some(get_env("UNSTABLE_BUNDLE_CPU_LIMIT", 4usize)),
                        memory: Some(get_env(
                            "UNSTABLE_BUNDLE_MEMORY_LIMIT",
                            4usize * 1024 * 1024 * 1024, // 4 GiB (also affects speed)
                        )),
                        process: Some(get_env("UNSTABLE_BUNDLE_PROCESS_LIMIT", 64usize)),
                        storage: get_env_raw("UNSTABLE_BUNDLE_STORAGE_LIMIT")
                            .map(|v| v.parse())
                            .transpose()?,
                        timeout: Some(get_env("UNSTABLE_BUNDLE_TIMEOUT_LIMIT", 180u64)),
                    },
                },
            },
        })
    }
}

/// Build route configuration
#[derive(Debug)]
pub struct BuildConfig {
    /// Build limits
    pub limits: Limits,
}

/// Bundle route configuration
#[derive(Debug)]
pub struct BundleConfig {
    /// Bundle limits
    pub limits: Limits,
}

/// General limits
#[derive(Debug)]
pub struct Limits {
    /// Route-based limits
    pub route: RouteLimits,
    /// Sandbox-only limits
    pub sandbox: SandboxLimits,
}

/// Route-based limits
#[derive(Debug)]
pub struct RouteLimits {
    // Maximum amount of concurrent requests
    pub concurrency: usize,
}

/// Get and parse the environment variable or return the given `default`.
fn get_env<T: FromStr>(key: &str, default: impl Into<T>) -> T {
    get_env_raw(key)
        .and_then(|s| s.parse().ok())
        .unwrap_or(default.into())
}

/// The API keys from `PG_API_KEYS` and `PG_API_KEY`, through `read`, which
/// takes a name without the `PG_` prefix. Separate from [`Config::from_env`]
/// so a test can check which variable is which without touching the process
/// environment.
fn api_keys_from(read: impl Fn(&str) -> Result<Option<String>>) -> Result<Option<ApiKeys>> {
    let list = read("API_KEYS")?;
    let key = read("API_KEY")?;
    ApiKeys::new(list.as_deref(), key.as_deref()).map_err(|error| anyhow!(error))
}

/// Read the environment variable `PG_<key>`; `None` only when it is not set.
///
/// Unlike [`get_env_raw`], a value that is not valid UTF-8 is an error, not
/// unset: for the API keys, unset means open. The error never holds the value.
fn read_env(key: &str) -> Result<Option<String>> {
    match dotenv::var(format!("PG_{key}")) {
        Ok(value) => Ok(Some(value)),
        Err(dotenv::Error::EnvVar(std::env::VarError::NotPresent)) => Ok(None),
        Err(_) => Err(anyhow!("PG_{key} is set but is not valid UTF-8")),
    }
}

/// Get the raw string environment variable.
///
/// All environment variables are prefixed with `PG_` in order to prevent clashes.
fn get_env_raw(key: &str) -> Option<String> {
    dotenv::var(format!("PG_{key}")).ok()
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    fn api_keys_with(vars: &[(&str, &str)]) -> Result<Option<ApiKeys>> {
        let vars: HashMap<String, String> = vars
            .iter()
            .map(|(name, value)| (name.to_string(), value.to_string()))
            .collect();
        api_keys_from(|name| Ok(vars.get(name).cloned()))
    }

    #[test]
    fn the_list_is_read_from_api_keys() {
        let keys = api_keys_with(&[("API_KEYS", "a,b")]).unwrap().unwrap();
        assert_eq!(keys.len(), 2);
    }

    #[test]
    fn the_single_key_is_read_from_api_key_and_not_split() {
        let keys = api_keys_with(&[("API_KEY", "a,b")]).unwrap().unwrap();
        assert_eq!(keys.len(), 1);
    }

    #[test]
    fn the_list_wins_over_the_single_key() {
        let keys = api_keys_with(&[("API_KEYS", "a,b,c"), ("API_KEY", "d")])
            .unwrap()
            .unwrap();
        assert_eq!(keys.len(), 3);
    }

    #[test]
    fn neither_set_leaves_the_routes_open() {
        assert!(api_keys_with(&[]).unwrap().is_none());
    }

    #[test]
    fn a_blank_list_without_a_single_key_fails() {
        let error = api_keys_with(&[("API_KEYS", " \n")]).unwrap_err();
        assert!(error.to_string().contains("PG_API_KEYS"), "{error}");
    }

    #[test]
    fn an_unreadable_variable_fails() {
        assert!(
            api_keys_from(|_| Err(anyhow!("PG_API_KEYS is set but is not valid UTF-8"))).is_err()
        );
    }

    #[test]
    fn the_logged_config_holds_no_key() {
        let mut config = Config::from_env().unwrap();
        config.api_keys = api_keys_with(&[("API_KEYS", "s3cret,other")]).unwrap();
        let printed = format!("{config:#?}");
        for key in ["s3cret", "other"] {
            assert!(!printed.contains(key), "{printed}");
        }
    }
}
