use wasm_bindgen::prelude::*;

#[wasm_bindgen(raw_module = "/src/utils/program-info.ts")]
extern "C" {
    pub type PgProgramInfo;

    /// Get the current program's IDL.
    #[wasm_bindgen(static_method_of = PgProgramInfo, js_name = "getIdlStr")]
    pub fn idl_string() -> Option<String>;

    /// Get the current program's pubkey.
    #[wasm_bindgen(static_method_of = PgProgramInfo, js_name = "getPkStr")]
    pub fn pk_string() -> Option<String>;
}

#[wasm_bindgen(raw_module = "/src/utils/settings.ts")]
extern "C" {
    pub type PgSettings;
    pub type PgSettingsConnection;

    /// Get the connection settings.
    #[wasm_bindgen(static_method_of = PgSettings, getter)]
    pub fn connection() -> PgSettingsConnection;

    /// Get the connection RPC URL.
    #[wasm_bindgen(method, getter)]
    pub fn endpoint(this: &PgSettingsConnection) -> String;

    /// Set the connection RPC URL.
    #[wasm_bindgen(method, setter)]
    pub fn set_endpoint(this: &PgSettingsConnection, value: &str);

    /// Get the connection commitment level.
    #[wasm_bindgen(method, getter)]
    pub fn commitment(this: &PgSettingsConnection) -> String;

    /// Set the connection commitment level.
    #[wasm_bindgen(method, setter)]
    pub fn set_commitment(this: &PgSettingsConnection, value: &str);

    /// Get transaction preflight checks.
    #[wasm_bindgen(method, getter, js_name = "preflightChecks")]
    pub fn preflight_checks(this: &PgSettingsConnection) -> bool;

    /// Set transaction preflight checks.
    #[wasm_bindgen(method, setter, js_name = "preflightChecks")]
    pub fn set_preflight_checks(this: &PgSettingsConnection, value: bool);
}

#[wasm_bindgen(raw_module = "/src/utils/terminal/terminal.ts")]
extern "C" {
    pub type PgTerminal;

    // TODO: Remove, there is no need for a new WASM function since `PgTerminal.log` is now static.
    /// Log to the playground terminal.
    #[wasm_bindgen(static_method_of = PgTerminal, js_name = "logWasm")]
    pub fn log_wasm(msg: &str);

    /// Enable the playground terminal.
    #[wasm_bindgen(static_method_of = PgTerminal, js_name = "enable")]
    pub fn enable();

}

#[wasm_bindgen(raw_module = "/src/utils/wallet/wallet.ts")]
extern "C" {
    pub type PgWallet;

    /// Get playground wallet's keypair.
    #[wasm_bindgen(static_method_of = PgWallet, js_name = "getKeypairBytes")]
    pub fn keypair_bytes() -> Vec<u8>;

    /// Get playground wallet's public key, without its secret key.
    #[cfg(feature = "wallet")]
    #[wasm_bindgen(static_method_of = PgWallet, js_name = "getPublicKeyBytes")]
    pub fn public_key_bytes() -> Vec<u8>;

    /// Whether the page holds the wallet's keys (the local signer provider).
    #[cfg(feature = "wallet")]
    #[wasm_bindgen(static_method_of = PgWallet, js_name = "hasKeysInPage")]
    pub fn has_keys_in_page() -> bool;

    /// Have the wallet with the given base58 public key sign serialized legacy
    /// message bytes; resolves to its 64-byte signature.
    #[cfg(feature = "wallet")]
    #[wasm_bindgen(static_method_of = PgWallet, js_name = "signTransactionMessage", catch)]
    pub async fn sign_transaction_message(
        message: &[u8],
        public_key: &str,
    ) -> Result<JsValue, JsValue>;

    /// The `PgWallet` export itself, to ask which methods it has.
    #[cfg(feature = "wallet")]
    #[wasm_bindgen(js_name = "PgWallet")]
    pub static PG_WALLET: JsValue;
}
