//! Signing a key's slot at the send step.
//!
//! `Signer` is synchronous, but some keys can only sign asynchronously (a
//! wallet behind a message channel). Such a key signs with
//! [`deferred_signature`], a marker, and registers a function here; the client
//! replaces the marker with the function's signature right before sending.

use std::{cell::RefCell, collections::HashMap, future::Future, pin::Pin, rc::Rc};

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
    // One entry per key, never cleared by a run: runs of a CLI can overlap,
    // and one run's cleanup would take the signer another run still needs
    static DEFERRED_SIGNERS: RefCell<HashMap<Pubkey, DeferredSign>> =
        RefCell::new(HashMap::new());
}

/// Register the function that signs `pubkey`'s marker slots at send,
/// replacing the one registered for that key before.
pub fn set_deferred_signer(pubkey: Pubkey, sign: DeferredSign) {
    DEFERRED_SIGNERS.with(|s| s.borrow_mut().insert(pubkey, sign));
}

/// Drop every registered signer.
pub fn clear_deferred_signers() {
    DEFERRED_SIGNERS.with(|s| s.borrow_mut().clear());
}

/// A copy of `tx` with every marker slot signed by its key's registered
/// signer. Other slots are kept as they are.
///
/// # Errors
///
/// When a marker slot's key has no signer, or the signer refuses: a marker
/// sent as it is would only come back as the cluster's signature failure.
pub async fn fill_deferred_signatures(tx: &Transaction) -> ClientResult<Transaction> {
    let mut tx = tx.clone();
    let marker = deferred_signature();
    let signers = (tx.message.header.num_required_signatures as usize).min(tx.signatures.len());
    let mut slots: Vec<(Pubkey, Vec<usize>)> = Vec::new();
    for i in (0..signers).filter(|&i| tx.signatures[i] == marker) {
        let key = tx.message.account_keys[i];
        match slots.iter_mut().find(|(k, _)| *k == key) {
            Some((_, at)) => at.push(i),
            None => slots.push((key, vec![i])),
        }
    }

    for (key, at) in slots {
        let sign = DEFERRED_SIGNERS
            .with(|s| s.borrow().get(&key).cloned())
            .ok_or_else(|| {
                ClientError::new(format!("No signer for {key}: the transaction was not sent"))
            })?;
        let signature = sign(tx.message_data()).await.map_err(|e| {
            ClientError::new(format!(
                "{key} did not sign the transaction, so it was not sent: {e}"
            ))
        })?;
        for i in at {
            tx.signatures[i] = signature;
        }
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
        let wallet = wallet.insecure_clone();
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

        assert_eq!(filled.signatures[0], tx.signatures[0]);
        assert_eq!(
            filled.signatures[1],
            wallet.sign_message(&tx.message_data())
        );
        assert!(filled.verify().is_ok());
    }

    #[test]
    fn fills_the_fee_payers_slot_the_send_returns() {
        let wallet = Keypair::new();
        let ix = system_instruction::transfer(&wallet.pubkey(), &Pubkey::new_unique(), 1);
        let mut tx = Transaction::new_with_payer(&[ix], Some(&wallet.pubkey()));
        tx.message.recent_blockhash = Hash::new_unique();
        tx.signatures[0] = deferred_signature();
        set_deferred_signer(wallet.pubkey(), signing_with(&wallet));

        let filled = block_on(fill_deferred_signatures(&tx)).unwrap();

        assert_eq!(
            filled.signatures[0],
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

        assert_eq!(filled, tx);
    }

    #[test]
    fn a_transaction_without_markers_is_sent_unchanged() {
        clear_deferred_signers();
        let payer = Keypair::new();
        let ix = system_instruction::transfer(&payer.pubkey(), &Pubkey::new_unique(), 1);
        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&payer.pubkey()),
            &[&payer],
            Hash::default(),
        );

        assert_eq!(block_on(fill_deferred_signatures(&tx)).unwrap(), tx);
    }

    #[test]
    fn a_marker_with_no_signer_for_its_key_is_an_error() {
        let payer = Keypair::new();
        let wallet = Keypair::new();
        let tx = transfer_with_marker(&payer, &wallet.pubkey());
        set_deferred_signer(Pubkey::new_unique(), signing_with(&Keypair::new()));

        let err = block_on(fill_deferred_signatures(&tx)).unwrap_err();

        assert!(err.to_string().contains(&wallet.pubkey().to_string()));
        assert!(err.to_string().contains("not sent"));
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

        assert!(err.to_string().contains("refused"));
        assert!(err.to_string().contains("not sent"));
    }
}
