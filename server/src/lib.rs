mod error;
mod sandbox;

pub mod log;
pub mod package;
pub mod program;
pub mod templates;
pub mod utils;

pub use error::{Error, Result};
pub use sandbox::{Limits as SandboxLimits, Sandbox};

#[cfg(test)]
mod ci_probe {
    #[test]
    fn fails() {
        panic!("probe: a failing server test must fail CI; reverted before merge");
    }
}
