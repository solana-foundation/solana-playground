//! Signing a key's slot at the send step.
//!
//! `Signer` is synchronous, but some keys can only sign asynchronously (a
//! wallet behind a message channel). Such a key signs with
//! [`deferred_signature`], a marker, and registers a function here; the client
//! replaces the marker with the function's signature right before sending.

use std::{cell::RefCell, future::Future, pin::Pin, rc::Rc};

use solana_sdk::{pubkey::Pubkey, signature::Signature, transaction::Transaction};

use crate::{ClientError, ClientResult};

/// The marker a deferred signer writes into its slot. Not the default
/// signature: `Transaction::try_sign` treats an all-zero slot as unsigned.
pub const DEFERRED_SIGNATURE: [u8; 64] = [0xff; 64];

/// The marker as a [`Signature`].
pub fn deferred_signature() -> Signature {
    Signature::from(DEFERRED_SIGNATURE)
}

/// Signs serialized message bytes, asynchronously.
pub type DeferredSign =
    Rc<dyn Fn(Vec<u8>) -> Pin<Box<dyn Future<Output = Result<Signature, String>>>>>;

thread_local! {
    static DEFERRED_SIGNER: RefCell<Option<(Pubkey, DeferredSign)>> = RefCell::new(None);
}

/// Register the key whose marker slots are signed at send, replacing any
/// registered before.
pub fn set_deferred_signer(pubkey: Pubkey, sign: DeferredSign) {
    DEFERRED_SIGNER.with(|s| *s.borrow_mut() = Some((pubkey, sign)));
}

/// Drop the registered key, so sending no longer fills markers.
pub fn clear_deferred_signer() {
    DEFERRED_SIGNER.with(|s| *s.borrow_mut() = None);
}

/// A copy of `tx` with the registered key's marker slots signed. Other slots,
/// and a slot the key already signed, are kept as they are.
pub async fn fill_deferred_signatures(tx: &Transaction) -> ClientResult<Transaction> {
    let mut tx = tx.clone();
    let Some((pubkey, sign)) = DEFERRED_SIGNER.with(|s| s.borrow().clone()) else {
        return Ok(tx);
    };

    let marker = deferred_signature();
    let signers = tx.message.header.num_required_signatures as usize;
    let slots: Vec<usize> = (0..signers.min(tx.signatures.len()))
        .filter(|&i| tx.message.account_keys[i] == pubkey && tx.signatures[i] == marker)
        .collect();
    if slots.is_empty() {
        return Ok(tx);
    }

    let signature = sign(tx.message_data()).await.map_err(ClientError::new)?;
    for i in slots {
        tx.signatures[i] = signature;
    }
    Ok(tx)
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::executor::block_on;
    use solana_sdk::{
        hash::Hash,
        signature::{Keypair, Signer},
        system_instruction,
    };

    /// A transfer from `from` paid by `payer`, with `from`'s slot holding the
    /// marker and `payer`'s a real signature.
    fn transfer_with_marker(payer: &Keypair, from: &Pubkey) -> Transaction {
        let ix = system_instruction::transfer(from, &Pubkey::new_unique(), 1);
        let mut tx = Transaction::new_with_payer(&[ix], Some(&payer.pubkey()));
        tx.partial_sign(&[payer], Hash::default());
        let i = tx.get_signing_keypair_positions(&[*from]).unwrap()[0].unwrap();
        tx.signatures[i] = deferred_signature();
        tx
    }

    fn signing_with(wallet: &Keypair) -> DeferredSign {
        let wallet = Keypair::from_bytes(&wallet.to_bytes()).unwrap();
        Rc::new(move |bytes: Vec<u8>| {
            let signature = wallet.sign_message(&bytes);
            Box::pin(async move { Ok(signature) })
        })
    }

    #[test]
    fn fills_only_the_registered_keys_marker_slot() {
        let payer = Keypair::new();
        let wallet = Keypair::new();
        let tx = transfer_with_marker(&payer, &wallet.pubkey());
        set_deferred_signer(wallet.pubkey(), signing_with(&wallet));

        let filled = block_on(fill_deferred_signatures(&tx)).unwrap();
        clear_deferred_signer();

        assert_eq!(filled.signatures[0], tx.signatures[0]);
        assert_eq!(
            filled.signatures[1],
            wallet.sign_message(&tx.message_data())
        );
        assert!(filled.verify().is_ok());
    }

    #[test]
    fn leaves_a_slot_the_key_already_signed() {
        let payer = Keypair::new();
        let wallet = Keypair::new();
        let ix = system_instruction::transfer(&wallet.pubkey(), &Pubkey::new_unique(), 1);
        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&payer.pubkey()),
            &[&payer, &wallet],
            Hash::default(),
        );
        set_deferred_signer(
            wallet.pubkey(),
            Rc::new(|_| Box::pin(async { panic!("must not be asked") })),
        );

        let filled = block_on(fill_deferred_signatures(&tx)).unwrap();
        clear_deferred_signer();

        assert_eq!(filled, tx);
    }

    #[test]
    fn no_registered_signer_sends_unchanged() {
        let payer = Keypair::new();
        let tx = transfer_with_marker(&payer, &Pubkey::new_unique());
        clear_deferred_signer();

        assert_eq!(block_on(fill_deferred_signatures(&tx)).unwrap(), tx);
    }

    #[test]
    fn a_refused_signature_is_a_client_error() {
        let payer = Keypair::new();
        let wallet = Keypair::new();
        let tx = transfer_with_marker(&payer, &wallet.pubkey());
        set_deferred_signer(
            wallet.pubkey(),
            Rc::new(|_| Box::pin(async { Err("refused".to_string()) })),
        );

        let err = block_on(fill_deferred_signatures(&tx)).unwrap_err();
        clear_deferred_signer();

        assert!(err.to_string().contains("refused"));
    }
}
