# Spec Delta

## ADDED Requirements

### Requirement: A deploy from a connected wallet names its two approvals

When an extension wallet is current, the Deploy stage's who-pays line SHALL name it ("From {wallet} ·
{short address} · {balance} SOL") and, before a run, SHALL add "{wallet} asks twice: to send SOL for the
deploy, then to deploy." While the run waits on the extension's signature, the running step SHALL add
"Approve in {wallet} (1 of 2)" for the transfer and "Approve in {wallet} (2 of 2)" for the final deploy or
upgrade, and "Approve in {wallet} to close the buffer" when a failed or stopped deploy closes a buffer whose
authority already went to the wallet. The extension SHALL be the program's upgrade authority afterwards.

#### Scenario: Deploy from Phantom on devnet (manual)

- **WHEN** Phantom is current and holds enough devnet SOL, and the user presses "Deploy to devnet"
- **THEN** Phantom asks twice, the progress names each approval, and the program's upgrade authority is
  Phantom's address

### Requirement: Leftover SOL goes back to the connected wallet

After a deploy from an extension wallet ends — succeeded, failed, stopped or cancelled — and its buffer is
settled, the Playground wallet SHALL send the extension what it holds over its balance before the run,
less the transfer's fee, when that is more than the fee. SOL the Playground wallet held before the run
SHALL stay. A return that fails SHALL print how much stayed in the Playground wallet and SHALL NOT change
the deploy's result.

#### Scenario: Leftover after a deploy (manual)

- **WHEN** a deploy from Phantom succeeds and the Playground wallet holds 0.09 SOL over its balance
  before the run
- **THEN** the Playground wallet sends Phantom that amount less the fee, and its balance is back to what
  it was

#### Scenario: A failed deploy closes the buffer (manual)

- **WHEN** a deploy from Phantom fails after the buffer was written, before its authority went to Phantom,
  and the buffer is closed
- **THEN** the buffer's rent and the fee headroom go back to Phantom
