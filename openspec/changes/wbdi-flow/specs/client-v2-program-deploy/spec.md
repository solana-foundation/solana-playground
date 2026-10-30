# Spec Delta

## Purpose

Puts a built program on one cluster at a time, from the playground or from the
user's own machine, and lets a mainnet deploy from the playground happen only
after the user accepts, each time, the risk of spending real SOL.

## ADDED Requirements

### Requirement: A deploy targets the selected cluster

A deploy SHALL upload the program binary to the cluster selected in the
connection settings and to no other. The selectable clusters SHALL be Playnet,
Localnet, Devnet, Testnet, Mainnet Beta and a custom RPC URL. A program on one
cluster SHALL NOT be shown as deployed on another.

#### Scenario: Devnet deploy is not on testnet

- **WHEN** the user deploys to Devnet and then selects Testnet
- **THEN** the Deploy stage shows the program as not deployed on Testnet

### Requirement: First deploy and upgrade

A deploy SHALL create the program at the program keypair's address when no
program exists there, and SHALL upgrade it when one exists and the paying
wallet is its upgrade authority. When the wallet is not the authority, the
deploy SHALL stop before any transaction and say which authority is required.

#### Scenario: Upgrade by a wallet that is not the authority

- **WHEN** the user deploys over a program whose upgrade authority is another
  key
- **THEN** no transaction is sent
- **AND** the playground names the upgrade authority the program requires

### Requirement: A deploy can be paused, resumed and cancelled

While the binary is written to the buffer, the user SHALL be able to pause,
resume and cancel the deploy. After a cancel, the playground SHALL offer to
close the buffer and return its rent to the paying wallet.

#### Scenario: Cancel and close the buffer

- **WHEN** the user cancels a deploy while the buffer is being written
- **AND** accepts closing the buffer
- **THEN** the buffer account is closed and its rent returns to the wallet

### Requirement: A low balance offers an airdrop

When the paying wallet holds less SOL than the deploy needs, the playground
SHALL say how much is missing and, off Mainnet Beta, offer an airdrop of that
amount. On Mainnet Beta it SHALL offer no airdrop.

#### Scenario: Short of SOL on devnet

- **WHEN** the wallet is short of SOL for a deploy on Devnet
- **THEN** the playground offers an airdrop of the missing amount

### Requirement: A mainnet deploy waits for the disclaimer

Every deploy or IDL upload to Mainnet Beta SHALL first open the mainnet
disclaimer dialog (`data-testid="mainnet-guard"`) and send nothing until the
user accepts it. This holds for every wallet and every way a deploy starts:
the Deploy button, the terminal `deploy` command and the assistant. A stored
acceptance never skips the dialog.

#### Scenario: Deploy on mainnet opens the disclaimer

- **WHEN** the user clicks Deploy with Mainnet Beta selected
- **THEN** the mainnet disclaimer dialog opens and no transaction is sent

#### Scenario: An extension wallet waits too

- **WHEN** the user deploys to Mainnet Beta with an extension wallet connected
- **THEN** the disclaimer opens before the extension is asked to sign anything

#### Scenario: The assistant and the terminal wait for the user

- **WHEN** the assistant or the terminal `deploy` command starts a deploy
  while Mainnet Beta is selected
- **THEN** the same disclaimer dialog opens and no transaction is sent until
  the user accepts it in the dialog

#### Scenario: The disclaimer is shown again

- **WHEN** the user accepted the disclaimer for one mainnet deploy and starts
  another
- **THEN** the disclaimer opens again with its checkbox unticked

### Requirement: Acceptance is an explicit checkbox

The disclaimer SHALL say that the deploy spends real SOL and, when the
playground wallet pays, that the key is stored in this browser, and SHALL
recommend the deploy scripts. Deploy to mainnet
(`data-testid="mainnet-guard-deploy"`) SHALL stay disabled until the user
ticks "I understand the risk" (`data-testid="mainnet-guard-accept"`), which
starts unticked. It also offers Download deploy scripts and Cancel.

#### Scenario: Deploy stays disabled until the box is ticked

- **WHEN** the disclaimer is open and the checkbox is unticked
- **THEN** Deploy to mainnet is disabled
- **AND** ticking the checkbox enables it

#### Scenario: Cancel sends nothing

- **WHEN** the user picks Cancel in the disclaimer
- **THEN** the dialog closes and no transaction is sent

### Requirement: Acceptance is recorded in a cookie

When the user picks Deploy to mainnet, the playground SHALL write the cookie
`pg_mainnet_disclaimer` with the disclaimer version and the acceptance time,
`Max-Age` 182 days, `SameSite=Lax` and `Secure`, before any transaction is
sent. The cookie holds no wallet address and no program id, and a later
acceptance overwrites it.

#### Scenario: The acceptance is written first

- **WHEN** the user ticks the checkbox and picks Deploy to mainnet
- **THEN** `pg_mainnet_disclaimer` holds the disclaimer version and the time
  of this acceptance before the first deploy transaction is sent

### Requirement: The export carries local deploy scripts

The project export SHALL contain a script that deploys the program binary
and a script that uploads the IDL to the Program Metadata program. Both
SHALL take the cluster and the payer keypair path as arguments, use the
user's installed Solana CLI and keep the program id of the playground's
program keypair. The export README SHALL say how to run them.

#### Scenario: Scripts in the export

- **WHEN** the user exports a built Anchor project
- **THEN** the zip holds the deploy script, the IDL upload script and the
  program keypair
- **AND** the README gives the commands to deploy to Mainnet Beta with them

#### Scenario: Scripts from the mainnet disclaimer

- **WHEN** the user picks Download deploy scripts in the mainnet disclaimer
- **THEN** the same export is downloaded and nothing is sent to the chain

### Requirement: The program keypair can be managed

The user SHALL be able to export the program keypair, import a keypair file to
replace it, and create a new one. Replacing a keypair of a deployed program
SHALL first say that the project will point at a new program id.

#### Scenario: Import a keypair

- **WHEN** the user imports a program keypair file
- **THEN** the next build declares that keypair's public key

### Requirement: Deploy telemetry

Deploy SHALL emit `deploy_started { cluster, kind }` whenever a deploy
starts, from the button, the terminal or the assistant, and before the
mainnet disclaimer; `deploy_succeeded { cluster, kind }` when the program is
live; and `deploy_failed { cluster, kind, phase }` when it is not. `cluster`: `playnet`, `localnet`, `devnet`, `testnet`, `mainnet`,
`custom`; `kind`: `first`, `upgrade`; `phase`: `buffer`, `write`, `deploy`,
`authority`.

#### Scenario: A failed write is tracked

- **WHEN** a first deploy on Devnet fails while the buffer is written
- **THEN** the memory provider records `deploy_failed` with
  `{ cluster: "devnet", kind: "first", phase: "write" }`

### Requirement: Mainnet disclaimer telemetry

The disclaimer SHALL emit `deploy_mainnet_warned { choice }` when it closes,
`choice` being `scripts`, `deploy` or `cancel`, and ticking or unticking its
checkbox SHALL emit `deploy_mainnet_accept_toggled { on }`, `on` a boolean.
Download deploy scripts SHALL also emit `deploy_scripts_exported` with no
parameters.

#### Scenario: The disclaimer choice is tracked

- **WHEN** the user cancels the mainnet disclaimer
- **THEN** the memory provider records `deploy_mainnet_warned` with
  `{ choice: "cancel" }`
- **AND** records neither `deploy_succeeded` nor `deploy_failed`

### Requirement: Every Deploy action emits an event

Every control on the Deploy screen that performs an action, a dialog choice
and Cancel included, SHALL emit its own event when used, separate from the
outcome events. A control without its event fails review. The requirements
that follow name each control's event.

#### Scenario: A deploy that stops at the disclaimer

- **WHEN** the user clicks Deploy on Mainnet Beta and cancels the disclaimer
- **THEN** the memory provider records `deploy_started` then
  `deploy_mainnet_warned`, and no outcome event

### Requirement: Deploy progress controls are tracked

Pause, Resume and Cancel SHALL emit `deploy_paused`, `deploy_resumed` and
`deploy_cancelled { cluster }`, the first two with `{ cluster }` as well. The
close buffer question SHALL emit `deploy_buffer_close_answered { choice }`,
`choice` being `close` or `keep`. The stale binary warning SHALL emit
`deploy_stale_warned { choice }`, `choice` being `deploy` or `cancel`.

#### Scenario: Keep the buffer after a cancel

- **WHEN** the user cancels a deploy on Devnet and keeps the buffer
- **THEN** the memory provider records `deploy_cancelled` with
  `{ cluster: "devnet" }` and `deploy_buffer_close_answered` with
  `{ choice: "keep" }`

### Requirement: Deploy funding and program id controls are tracked

Airdrop SHALL emit `deploy_airdrop_requested { cluster }`. Copy program id
SHALL emit `deploy_program_id_copied` with no parameters.

#### Scenario: Airdrop on testnet

- **WHEN** the user accepts the airdrop offer on Testnet
- **THEN** the memory provider records `deploy_airdrop_requested` with
  `{ cluster: "testnet" }`

### Requirement: Program keypair controls are tracked

Export and New keypair SHALL emit `deploy_keypair_exported` and
`deploy_keypair_created`. Import SHALL emit `deploy_keypair_import_started`
on the click and `deploy_keypair_imported` once the keypair is replaced. The
warning before replacing a deployed program's keypair SHALL emit
`deploy_keypair_replace_warned { choice }`, `choice` being `replace` or
`cancel`. Unlisted parameters are none.

#### Scenario: Replacing a keypair is cancelled

- **WHEN** the user imports a keypair for a deployed program and cancels the
  warning
- **THEN** the memory provider records `deploy_keypair_import_started`, then
  `deploy_keypair_replace_warned` with `{ choice: "cancel" }`, and no
  `deploy_keypair_imported`
