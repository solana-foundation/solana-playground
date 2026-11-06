# Spec Delta

## Purpose

The Interact stage lets a person call a deployed program's instructions from a
form built from its IDL, read the result in the panel, and see the calls made
before on the same network.

## ADDED Requirements

### Requirement: The head names the program it calls
When the Interact stage has a program to call, its head SHALL show the program
id shortened in the middle (first four and last four characters joined by
"…") with a copy button labelled "Copy program id" that copies the full id,
and the network name.

#### Scenario: A deployed program (manual)
- **WHEN** a program is deployed on devnet and the person opens Interact
- **THEN** the head shows "Program", the shortened id, a "Copy program id" button and "devnet"

### Requirement: Instruction chips pick one form
The stage SHALL show one chip per IDL instruction, in IDL order, as a
single-choice group named "Instruction". The first instruction SHALL be
picked when nothing is, and only the picked instruction's form SHALL be drawn.
The pick SHALL survive a re-render and fall back to the first instruction when
the picked one leaves the IDL.

#### Scenario: Picking an instruction (manual)
- **WHEN** the IDL has `initialize` and `increment` and the person picks `increment`
- **THEN** only the `increment` form is drawn, with its Arguments and Accounts

### Requirement: The form calls with a Call button
The form SHALL keep the typed Arguments and Accounts inputs, Fill and Reset,
and SHALL show a Fee payer row naming who pays the fee and their balance
("Fee paid by Playground wallet · 0.5 SOL", or the connected wallet's name).
Its main button SHALL read "Call <instruction>" (for example "Call increment"), and "Calling…" while the call is in flight,
when the inputs are locked. Call SHALL be off without a wallet, while an input
is invalid, and while the SOL needed callout shows.

#### Scenario: Calling (manual)
- **WHEN** the person presses "Call increment" on a valid form
- **THEN** the button reads "Calling…" and is off until the result arrives

### Requirement: The result shows in the panel
After a call, the panel SHALL show its result under the form, as a region named
"Call result":

- success: a status dot, "Succeeded", the instruction name, the signature with
  a "Copy signature" button, and a link "View on Explorer (<network>)";
- failure: "Failed", the failing log line set apart, and every log line behind
  a "Show all logs" toggle; a call that never reached the network shows the
  error message as its failing line.

The failing line SHALL be the first log line containing "Error Code:",
"custom program error" or "failed:"; when none does, the last log line; when
there are no logs, the error message. The terminal SHALL keep printing the
call and its outcome.

#### Scenario: A failed call (manual)
- **WHEN** a call fails with logs that contain "Error Code: AccountNotInitialized"
- **THEN** the result shows "Failed" with that line set apart and "Show all logs"

### Requirement: Calls join a history per program and network
Every finished call SHALL be recorded with its program id, network,
instruction, outcome, signature (when there is one), failing line and time, in
the browser, capped at the 50 newest records. The stage SHALL list the records
of the program and network it calls, newest first, under "Call history", each
with its instruction, outcome, time and, when it has a signature, an Explorer
link. Picking a row SHALL pick its instruction's chip when the IDL still has
it. The history SHALL survive a reload and SHALL NOT store logs.

#### Scenario: History after a reload (manual)
- **WHEN** the person calls `increment` twice, then reloads and opens Interact
- **THEN** "Call history" lists both calls, newest first

### Requirement: A callout says the code was built after the deploy
When the last successful build of this session is newer than the latest deploy
of this project on the current network, the stage SHALL show the callout "The
deployed program is older than your code. Redeploy to call the latest version."
with a "Redeploy" button that opens the Deploy stage.

#### Scenario: Build after deploy (manual)
- **WHEN** the person deploys, edits and builds again, then opens Interact
- **THEN** the callout shows with "Redeploy"

### Requirement: A callout says when the fee payer has too little SOL
When the current wallet's balance is known and below one transaction fee
(5000 lamports), the stage SHALL show the callout "This call needs a small fee
in <network> SOL. Your wallet has <balance> SOL." and SHALL keep Call off. When
the network has a faucet, the callout SHALL offer "Get <network> SOL", which
requests an airdrop and keeps the form's values.

#### Scenario: Empty wallet on devnet (manual)
- **WHEN** the Playground wallet has 0 SOL on devnet and the person opens Interact
- **THEN** the callout shows with "Get devnet SOL" and Call is off
