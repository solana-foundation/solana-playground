//! The built-in wallet as a `Signer` for the WASM CLIs.
//!
//! Where the app keeps the wallet's key off the page and signs a transaction
//! message for it (client-v2 under the key origin), the CLI never sees the
//! secret key: [`PgWalletSigner`] writes a marker and the client asks the app
//! for the real signature when it sends. Where the page holds the key (the
//! local provider, upstream's client), the CLI signs with the key bytes as
//! before, so `--sign-only` still prints a real signature.

use std::rc::Rc;

use solana_client_wasm::deferred_signer::{deferred_signature, set_deferred_signer};
use solana_sdk::{
    pubkey::Pubkey,
    signature::{Keypair, Signature},
    signer::{Signer, SignerError},
};
use wasm_bindgen::{JsCast, JsValue};

use crate::js::{PgWallet, PG_WALLET};

/// Signs the wallet's slot with the marker; the real signature is filled in
/// at send.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PgWalletSigner {
    pubkey: Pubkey,
}

impl PgWalletSigner {
    /// Only [`wallet_signer`] makes one, so its key always has a deferred
    /// signer registered.
    pub(crate) fn new(pubkey: Pubkey) -> Self {
        Self { pubkey }
    }
}

impl Signer for PgWalletSigner {
    fn try_pubkey(&self) -> Result<Pubkey, SignerError> {
        Ok(self.pubkey)
    }

    fn try_sign_message(&self, _message: &[u8]) -> Result<Signature, SignerError> {
        Ok(deferred_signature())
    }

    fn is_interactive(&self) -> bool {
        false
    }
}

/// The built-in wallet: the key bytes, or a signer that defers to the app.
#[derive(Debug)]
pub enum WalletSigner {
    Key(Keypair),
    Deferred(PgWalletSigner),
}

impl Clone for WalletSigner {
    fn clone(&self) -> Self {
        match self {
            Self::Key(k) => Self::Key(k.insecure_clone()),
            Self::Deferred(s) => Self::Deferred(*s),
        }
    }
}

impl Signer for WalletSigner {
    fn try_pubkey(&self) -> Result<Pubkey, SignerError> {
        match self {
            Self::Key(k) => k.try_pubkey(),
            Self::Deferred(s) => s.try_pubkey(),
        }
    }

    fn try_sign_message(&self, message: &[u8]) -> Result<Signature, SignerError> {
        match self {
            Self::Key(k) => k.try_sign_message(message),
            Self::Deferred(s) => s.try_sign_message(message),
        }
    }

    fn is_interactive(&self) -> bool {
        false
    }
}

/// Whether the app signs for the wallet because the key is off the page.
/// Upstream's client has no `signTransactionMessage` and holds the key.
fn app_signs() -> bool {
    let signs = js_sys::Reflect::get(&PG_WALLET, &JsValue::from_str("signTransactionMessage"))
        .map(|f| f.is_function())
        .unwrap_or(false);
    signs && !PgWallet::holds_keys_in_page()
}

/// The current built-in wallet as a signer. Where the app signs, this also
/// registers the app as the client's deferred signer for the wallet's key.
pub fn wallet_signer() -> WalletSigner {
    if !app_signs() {
        return WalletSigner::Key(Keypair::from_bytes(&PgWallet::keypair_bytes()).unwrap());
    }

    let pubkey = Pubkey::try_from(PgWallet::public_key_bytes().as_slice()).unwrap();
    set_deferred_signer(
        pubkey,
        Rc::new(move |message: Vec<u8>| {
            Box::pin(async move {
                let signature = PgWallet::sign_transaction_message(&message, &pubkey.to_string())
                    .await
                    .map_err(|e| error_message(&e))?;
                Signature::try_from(js_sys::Uint8Array::new(&signature).to_vec().as_slice())
                    .map_err(|e| e.to_string())
            })
        }),
    );
    WalletSigner::Deferred(PgWalletSigner::new(pubkey))
}

/// The message of a rejected promise: an `Error`'s, a string, or an
/// object's `message` field (a standard wallet's rejection).
fn error_message(e: &JsValue) -> String {
    e.dyn_ref::<js_sys::Error>()
        .map(|e| String::from(e.message()))
        .or_else(|| e.as_string())
        .or_else(|| {
            js_sys::Reflect::get(e, &JsValue::from_str("message"))
                .ok()
                .and_then(|m| m.as_string())
        })
        .unwrap_or_else(|| format!("{e:?}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use solana_sdk::{hash::Hash, system_instruction, transaction::Transaction};

    #[test]
    fn the_marker_passes_try_sign() {
        let payer = Keypair::new();
        let wallet = PgWalletSigner::new(Pubkey::new_unique());
        let ix = system_instruction::transfer(&wallet.pubkey(), &Pubkey::new_unique(), 1);
        let mut tx = Transaction::new_with_payer(&[ix], Some(&payer.pubkey()));

        tx.try_sign(&[&payer as &dyn Signer, &wallet], Hash::default())
            .unwrap();

        assert_eq!(tx.signatures[1], deferred_signature());
        assert!(tx.is_signed());
    }
}
