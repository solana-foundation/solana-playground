use tracing_subscriber::{fmt, EnvFilter};

/// Initialize logging in the application.
///
/// Log levels via environment variables are supported similar to [`env-logger`].
///
/// [`env-logger`]: https://github.com/rust-cli/env_logger
pub fn init_logging(verbose: bool) {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));

    let fmt_layer = fmt().with_target(false).with_env_filter(filter);

    if verbose {
        fmt_layer.pretty().init();
    } else {
        fmt_layer.compact().init();
    }
}
