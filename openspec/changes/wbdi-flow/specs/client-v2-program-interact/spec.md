# Spec Delta

## Purpose

Lets the user call a deployed program's instructions through its IDL, on any
cluster and for any program id, and see what each call did, the way Solana
Explorer's Interactive IDL does.

## ADDED Requirements

### Requirement: Interact opens any program id

Interact SHALL open the project's deployed program by default, and SHALL let
the user enter any program id on the selected cluster instead
(`data-testid="interact-program-id"`). A program id with no executable program
on the cluster SHALL be refused with that reason.

#### Scenario: Someone else's program

- **WHEN** the user enters the id of a program they did not build
- **THEN** Interact reads that program's IDL from the chain
- **AND** shows its instructions

### Requirement: The form is built from the selected IDL

Interact SHALL list every instruction of the selected IDL with a form for its
arguments and accounts, for each format the playground reads. Switching the IDL
source SHALL rebuild the form. An IDL whose address differs from the program
id SHALL be flagged before anything is sent.

#### Scenario: Switch to the legacy IDL

- **WHEN** the user switches the IDL source to the Anchor IDL account
- **THEN** the instruction list is rebuilt from that IDL

### Requirement: Arguments are checked against the IDL types

Each argument field SHALL accept only values of its IDL type, including
integers by width and sign, public keys, strings, booleans, options, vectors,
fixed arrays and defined types, and SHALL say which field is wrong before a
send.

#### Scenario: A u8 out of range

- **WHEN** the user types 256 into a `u8` argument
- **THEN** the field is marked invalid and the call cannot be sent

### Requirement: Known accounts are filled in

Interact SHALL fill a signer named as an authority, owner, payer or signer
with the connected wallet, and SHALL fill the System, Token, Associated Token
and other known program accounts by name. The user SHALL be able to replace
any filled value.

#### Scenario: Payer is the wallet

- **WHEN** an instruction has a signer account named `payer`
- **THEN** the field holds the connected wallet's address

### Requirement: PDAs are derived from the IDL seeds

For an account whose IDL gives `pda` seeds, Interact SHALL derive the address
from const, argument and account seeds as soon as their values are filled, and
SHALL derive it again when one changes. It SHALL use the program the seeds
name, and the program being called when they name none.

#### Scenario: A PDA follows its seed

- **WHEN** an account's seeds are a constant and the `user` account
- **AND** the user fills the `user` account
- **THEN** the PDA field holds the address derived from both seeds

#### Scenario: Seeds from another program

- **WHEN** an IDL's `pda` names the Associated Token program
- **THEN** the address is derived with that program id

### Requirement: An address can be built from seeds by hand

Every public key field SHALL offer From seed, an editor where the user adds
typed seeds (string, public key, bytes, signed and unsigned integers), takes a
seed's value from another argument or account, picks the program id, and
generates the address. This holds when the IDL gives no seeds.

#### Scenario: From seed without IDL seeds

- **WHEN** the user opens From seed on an account the IDL gives no seeds for
- **AND** adds the string seed "vault" and the wallet's key, and generates
- **THEN** the field holds the derived address for the selected program id

### Requirement: A call is simulated before it is sent

Interact SHALL offer Simulate, which needs no signature, and Send. Send SHALL
simulate first unless the user turns that off
(`data-testid="simulate-before-send"`), on by default. Turning it off SHALL
show a warning (`data-testid="simulate-skipped-warning"`).

#### Scenario: Simulate shows logs

- **WHEN** the user simulates a call
- **THEN** the result shows the program logs and the compute units used
- **AND** nothing is signed or sent

#### Scenario: A failed simulation stops the send

- **WHEN** the user sends a call whose simulation fails
- **THEN** no transaction is sent and the simulation logs are shown

### Requirement: The result of a call is shown

After a send, Interact SHALL show whether the transaction confirmed, its logs,
an error mapped to the IDL's error name when the program returned one, and a
link to the transaction in an explorer for the selected cluster.

#### Scenario: A program error by name

- **WHEN** a call fails with custom error 6000
- **AND** the IDL names error 6000 `Unauthorized`
- **THEN** the result shows `Unauthorized` and the logs

### Requirement: A mainnet send is confirmed

The first send to Mainnet Beta in a session SHALL ask the user to confirm that
the transaction spends real SOL (`data-testid="interact-mainnet-confirm"`).
Simulate SHALL NOT ask.

#### Scenario: First mainnet send

- **WHEN** the user sends a call on Mainnet Beta for the first time in a session
- **THEN** a confirmation opens and nothing is sent until the user confirms

### Requirement: Interact works on a local validator

Interact SHALL work the same on Localnet, a validator the user runs on their
machine, and on Playnet as on the public clusters, with the IDL read from that
cluster or supplied locally.

#### Scenario: Call a program on Localnet

- **WHEN** a program is deployed to a validator at `localhost:8899`
- **AND** Localnet is selected
- **THEN** the user can simulate and send its instructions

### Requirement: Interact telemetry

Interact SHALL emit `interact_simulated { cluster, ok }` after a simulation,
`interact_sent { cluster }` when a transaction is sent, and
`interact_failed { cluster, phase }` when a call fails. `cluster` is as in
deploy, `ok` is a boolean, and `phase` is `validation`, `simulation`, `send`
or `confirm`. No event carries a program id, address or signature.

#### Scenario: A failed confirmation is tracked

- **WHEN** a sent transaction fails to confirm on Devnet
- **THEN** the memory provider records `interact_failed` with
  `{ cluster: "devnet", phase: "confirm" }`

### Requirement: Every Interact action emits an event

Every control on the Interact screen that performs an action, a dialog choice
and Cancel included, SHALL emit its own event when used, separate from the
outcome events. No event carries an instruction name, which comes from the
user's IDL. A control without its event fails review. The requirements that
follow name each control's event.

#### Scenario: A send that stops at validation

- **WHEN** the user clicks Send with an invalid argument
- **THEN** the memory provider records `interact_send_started` and
  `interact_failed` with `phase: "validation"`, and no `interact_sent`

### Requirement: Interact call controls are tracked

Simulate and Send SHALL emit `interact_simulate_started { cluster }` and
`interact_send_started { cluster }` on the click. The simulate before send
toggle SHALL emit `interact_simulate_toggled { on }`, `on` a boolean. The
mainnet confirmation SHALL emit `interact_mainnet_confirmed { choice }`,
`choice` being `send` or `cancel`.

#### Scenario: Turning simulation off

- **WHEN** the user turns simulate before send off
- **THEN** the memory provider records `interact_simulate_toggled` with
  `{ on: false }`

### Requirement: Interact form controls are tracked

Opening a program id SHALL emit `interact_program_opened { own }`, `own`
true for the project's program. Expanding an instruction SHALL emit
`interact_instruction_opened`, Fill random `interact_random_filled`, From seed
`interact_seed_opened` and its Generate `interact_seed_generated { seeds }`,
`seeds` the number of seeds. Unlisted parameters are none.

#### Scenario: Opening someone else's program

- **WHEN** the user opens a program id they did not build
- **THEN** the memory provider records `interact_program_opened` with
  `{ own: false }`

### Requirement: Interact result and empty state controls are tracked

The explorer link SHALL emit `interact_explorer_opened` and Copy logs
`interact_logs_copied`, with no parameters. Each empty state action SHALL
emit `interact_empty_action { action }`, `action` being `build` for Go to
Build, `deploy` for Go to Deploy and `idl` for Load IDL file.

#### Scenario: Go to Deploy from the empty state

- **WHEN** the user picks Go to Deploy in the Interact empty state
- **THEN** the memory provider records `interact_empty_action` with
  `{ action: "deploy" }`
