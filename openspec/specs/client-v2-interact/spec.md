# client-v2-interact Specification

## Purpose

The Interact stage lets a person call a deployed program's instructions from a
form built from its IDL, read the result in the panel, and see the calls made
before on the same network.

## Requirements

### Requirement: The head names the program it calls

When the Interact stage has a program to call, its head SHALL show the program
id shortened in the middle (first four and last four characters joined by
"…") with a copy button labelled "Copy program id" that copies the full id,
and the network name as a label, capitalised ("Devnet", "Mainnet" for
mainnet-beta). Inside a sentence (the fee callout) the network is lower case.

#### Scenario: A deployed program (manual)

- **WHEN** a program is deployed on devnet and the person opens Interact
- **THEN** the head shows "Program", the shortened id, a "Copy program id" button and "Devnet"

### Requirement: The form calls with a Send button

The open card SHALL keep the typed Arguments and Accounts inputs, and SHALL
show a Fee payer row naming who pays the fee and their balance ("Fee payer ·
Playground wallet · 0.5 SOL", or the connected wallet's name) above its row.
The row's primary button SHALL read "Send", and "Sending…" while the call is
in flight, when the inputs are locked; "Fill with Random" and "Reset" SHALL sit
beside it as quiet buttons for an instruction that has inputs. Send SHALL be
off without a wallet, while the SOL needed callout shows, and while an input
is invalid, and the row SHALL say why, first that applies: "Connect a wallet to
send", "Add <network> SOL to send" (the network lower case, as inside a
sentence), "Fill every field to send". The SOL needed callout stays as it is.

#### Scenario: Send held for the fee (manual)

- **WHEN** a wallet with 0 SOL on devnet is connected and the `increment` card is open
- **THEN** Send is off and the row reads "Add devnet SOL to send"

#### Scenario: Calling (manual)

- **WHEN** the person presses Send on a valid `increment` card
- **THEN** the button reads "Sending…" and is off until the result arrives

### Requirement: The result shows in the panel

After a call, the panel SHALL show its result right under the card of the
instruction that made it, as a region named "Call result":

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

#### Scenario: The result follows its card (manual)

- **WHEN** the IDL has `initialize` and `increment` and the person sends `increment`
- **THEN** "Call result" sits after the `increment` card, not after `initialize`

### Requirement: A sent transaction's toast

When the app sends a transaction, the toast SHALL read "Transaction sent" and
show the signature shortened in the middle (`9hJqVk…WxCvBz`), linked to the
transaction on the explorer picked in Settings. It SHALL fire for every
transaction the app sends, not only from Interact, except one a tutorial card
already links, one sent on playnet, and any while the "Show transaction
notifications" setting is off.

#### Scenario: The toast names the signature (manual)

- **WHEN** the person sends `increment` and the transaction goes out
- **THEN** a toast reads "Transaction sent" beside the shortened signature, which opens the transaction on the picked explorer

### Requirement: Calls join a history per program and network

Every finished call SHALL be recorded with its program id, network,
instruction, outcome, signature (when there is one), failing line and time, in
the browser, capped at the 50 newest records. The stage SHALL list the records
of the program and network it calls, newest first, under "Call history", each
with its instruction, outcome, time and, when it has a signature, an Explorer
link. Picking a row SHALL open its instruction's card and scroll it into view
when the IDL still has it, leaving other open cards as they are. The history SHALL survive a reload and SHALL NOT store logs.

#### Scenario: History after a reload (manual)

- **WHEN** the person calls `increment` twice, then reloads and opens Interact
- **THEN** "Call history" lists both calls, newest first

#### Scenario: A history row opens its card (manual)

- **WHEN** every card is folded and the person picks an `increment` row in "Call history"
- **THEN** the `increment` card opens and is scrolled into view

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
in <network> SOL. Your wallet has <balance> SOL." and SHALL keep Send off. When
the network has a faucet, the callout SHALL offer "Get <network> SOL", which
requests an airdrop and keeps the cards' values.

#### Scenario: Empty wallet on devnet (manual)

- **WHEN** the Playground wallet has 0 SOL on devnet and the person opens Interact
- **THEN** the callout shows with "Get devnet SOL" and Send is off

### Requirement: Call history sits beside the form on a wide stage

When the Interact stage is at least 40rem wide, the `ready` surface SHALL show
the instruction cards and each card's last result in a left column and "Call history"
in a right column 18rem wide that stays in view beside the cards while they
scroll. Before the first call the right column SHALL show the heading, the
title "No calls yet" and the line "Calls you make here show with their
result.". Accounts and Events SHALL sit below both
columns. On a narrower stage the surface SHALL keep one column in the order
cards (with the result under its card), Call history, Accounts, Events, and
SHALL NOT show a history section before the first call.

#### Scenario: Wide stage (manual)

- **WHEN** the stage is 48rem wide and the program has calls in its history
- **THEN** "Call history" is to the right of the cards, top-aligned with the first card

#### Scenario: Wide stage before the first call (manual)

- **WHEN** the stage is 48rem wide and the program has no calls on this network
- **THEN** the right column shows "Call history", "No calls yet" and "Calls you
  make here show with their result."

#### Scenario: Narrow stage (manual)

- **WHEN** the stage is 30rem wide
- **THEN** "Call history" follows the cards in one column

### Requirement: Instruction cards fold on their own

The stage SHALL show one card per IDL instruction, in IDL order, drawn as
the client-v2-stages capability on foundation master describes it: a head with
the name and "n args · n accounts", "Arguments" and "Accounts" groups, and one
row ending in Send. Each card SHALL
fold on its own, so several may be open at once, and every card SHALL be
folded on arrival. Which cards are open SHALL survive a re-render.

#### Scenario: Arriving on the stage

- **WHEN** the person opens Interact on a program with `initialize` and `increment`
- **THEN** both cards are folded and show only their heads

#### Scenario: Two cards open

- **WHEN** the person opens the `initialize` card, then the `increment` card
- **THEN** both cards show their inputs
