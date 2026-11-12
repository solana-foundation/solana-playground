## REMOVED Requirements

### Requirement: Instruction chips pick one form
**Reason**: Design alignment (6 Nov 2026) took Almaz's #272 card, described in
client-v2-stages, over the chips.
**Migration**: "Instruction cards fold on their own" below.

## ADDED Requirements

### Requirement: Instruction cards fold on their own
The stage SHALL show one card per IDL instruction, in IDL order, drawn as
client-v2-stages describes (head with the name and "n args · n accounts",
"Arguments" and "Accounts" groups, one row ending in Test). Each card SHALL
fold on its own, so several may be open at once, and every card SHALL be
folded on arrival. Which cards are open SHALL survive a re-render.

#### Scenario: Arriving on the stage
- **WHEN** the person opens Interact on a program with `initialize` and `increment`
- **THEN** both cards are folded and show only their heads

#### Scenario: Two cards open
- **WHEN** the person opens the `initialize` card, then the `increment` card
- **THEN** both cards show their inputs

## MODIFIED Requirements

### Requirement: The form calls with a Call button
The open card SHALL keep the typed Arguments and Accounts inputs, and SHALL
show a Fee payer row naming who pays the fee and their balance ("Fee payer ·
Playground wallet · 0.5 SOL", or the connected wallet's name) above its row.
The row's primary button SHALL read "Test", and "Testing…" while the call is
in flight, when the inputs are locked; "Fill with Random" and "Reset" SHALL sit
beside it as quiet buttons for an instruction that has inputs. Test SHALL be
off without a wallet, while the SOL needed callout shows, and while an input
is invalid, and the row SHALL say why, first that applies: "Connect a wallet to
test", "Add <network> SOL to test" (the network lower case, as inside a
sentence), "Fill every field to test". The SOL needed callout stays as it is.

#### Scenario: Test held for the fee (manual)
- **WHEN** a wallet with 0 SOL on devnet is connected and the `increment` card is open
- **THEN** Test is off and the row reads "Add devnet SOL to test"

#### Scenario: Calling (manual)
- **WHEN** the person presses Test on a valid `increment` card
- **THEN** the button reads "Testing…" and is off until the result arrives

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

#### Scenario: The result follows its card
- **WHEN** the IDL has `initialize` and `increment` and the person tests `increment`
- **THEN** "Call result" sits after the `increment` card, not after `initialize`

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

#### Scenario: A history row opens its card
- **WHEN** every card is folded and the person picks an `increment` row in "Call history"
- **THEN** the `increment` card opens and is scrolled into view

### Requirement: Call history sits beside the form on a wide stage
When the Interact stage is at least 40rem wide, the `ready` surface SHALL show
the instruction cards and the last result in a left column and "Call history"
in a right column 18rem wide that stays in view beside the cards while they
scroll. Before the first call the right column SHALL show the heading and
"Calls you send show up here.". Accounts and Events SHALL sit below both
columns. On a narrower stage the surface SHALL keep one column in the order
cards (with the result under its card), Call history, Accounts, Events, and
SHALL NOT show a history section before the first call.

#### Scenario: Wide stage (manual)
- **WHEN** the stage is 48rem wide and the program has calls in its history
- **THEN** "Call history" is to the right of the cards, top-aligned with the first card

#### Scenario: Narrow stage (manual)
- **WHEN** the stage is 30rem wide
- **THEN** "Call history" follows the cards in one column
