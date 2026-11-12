# tutorial-runs Specification

## Purpose
How a conversation tutorial's acts run for real (build, deploy, client runs and calls on devnet) and how a step's goal is judged on what actually happened.

## Requirements

### Requirement: A refused call passes the step that expects it

A failed run or call SHALL report what the program refused when its
transaction reached the program: the refused instruction and, when the program
returned one, its error's code and name. A step whose goal is `refused` SHALL
pass when such a result names the goal's instruction and:

- its error matches the goal's error (each of the name and the code the goal
  gives), when the goal gives one;
- its transaction log matches the goal's pattern, when the goal gives one.

A result that never reached the program (no wallet, a send that failed) SHALL
pass no `refused` goal. A refusal that passes the step SHALL be recorded as
refused, not failed, and its card SHALL offer neither Explain nor "I'll fix it
myself". A refusal that does not meet the step's goal SHALL stay a failure,
explained as any other. The call act, the client run and the Call panel SHALL
pass the same goal, and a confirmed call SHALL pass no `refused` goal.

#### Scenario: Out of energy (manual)

- **WHEN** on Lumberjack's step 3 a chop is refused with `NotEnoughEnergy`
  6000
- **THEN** step 3 passes and its win follows

#### Scenario: Out of memory, not too big (manual)

- **WHEN** on Zero Copy's step 2, whose goal is `refused` on `grow` with the
  pattern `out of memory`, a grow is refused because it added more than
  10 KB at once
- **THEN** the step does not pass and the refusal is a failure
- **AND** a later grow refused with "memory allocation failed, out of memory"
  in its log passes it

### Requirement: A landed run reads the account its act names

After a run or call landed, the runner SHALL read the account the act's `account` names from among those the run wrote to, and save its address, size in bytes and scalar fields with the result. A read that fails SHALL be reported and leave the result without a reading; the run still landed.

#### Scenario: A chop lands (manual)

- **WHEN** a `chop_tree` act with a player view lands
- **THEN** its result holds the player's address, size and `energy`, `wood` and `lastLogin` as strings

#### Scenario: The read fails (manual)

- **WHEN** the chain does not answer the read
- **THEN** the run's result is still ok and the failure is reported

### Requirement: A repeating call card

A call act whose definition has `repeat` SHALL stay one card across its presses.
Each press SHALL run one call and add one line to the card: a check and the
program's log line and the short signature, or a cross and the refusal. The
live card SHALL show the last three lines, newest last, and the record it leaves
SHALL show them all.

After a first press by hand, while every press has landed, the card SHALL offer
a second button named by `repeat.label`. That button SHALL run the presses one
after another, 250 ms apart, and its label SHALL read "Stop" while it does. Stop,
or any press that did not land, SHALL end the repetition; a call already in
flight SHALL finish. A reload SHALL NOT resume the repetition, since a run is
never repeated by the engine. A press that failed, including a refusal the step's
goal does not name, SHALL post its failed result card as any other call does, and
adds no line. The finished card SHALL read its `record` and the count ("Grew 4
times"), or its plain record when the step passed with no press.

The card SHALL end when the step's goal passes, or when a press's log line
matches `repeat.until`. On `repeat.until` the lesson SHALL flow on to the next
beat, and the card SHALL take no more presses. Without either, the card SHALL
stay live, and a press that landed SHALL post nothing else. Each press SHALL
fire `tutorial_action_run`, and the card SHALL add no event of its own.

#### Scenario: Chopping until the program refuses (manual)

- **GIVEN** a chop step whose goal is the program's `NotEnoughEnergy` refusal
- **WHEN** the learner presses Chop once, then "Chop until out of energy"
- **THEN** a line is added per chop and the button reads "Stop" meanwhile
- **AND** the refusal adds its line, ends the repetition and passes the step

#### Scenario: Growing to a size before the next act (manual)

- **GIVEN** a Grow card with `repeat.until` matching the 40 KB log line, followed
  by a Paint act
- **WHEN** the press that logs 40 KB lands
- **THEN** the card becomes its record, with one line per press
- **AND** the Paint card follows, and pressing Grow again does nothing

#### Scenario: Stop (manual)

- **WHEN** the learner presses Stop while a call is in flight
- **THEN** that call finishes and adds its line, and no further call is sent

### Requirement: The engine remembers the accounts calls wrote to

When a run or call lands, the engine SHALL remember each account the call wrote
to, other than the wallet, by its name in the IDL, with the latest address
winning. The memory SHALL be saved with the conversation's progress, so a reload
keeps it, and Start over SHALL clear it, while a step's Reset SHALL keep it, since
the step's create call replaces it. A save without it SHALL read as empty.

Every later call act and Call panel call SHALL send a remembered address for an
account of the same name, over a Test form generator that derives nothing, so
not for an account the IDL marks as a signer or one from seeds. The Call panel's
half lands with HOO-2358. A call made from the Call panel SHALL be remembered
the same way as one made from a card.

#### Scenario: A map survives a reload (manual)

- **GIVEN** `init_map` landed and wrote to `map`
- **WHEN** the learner reloads and presses Grow, whose `map` has no seeds
- **THEN** the call targets the address `init_map` wrote to

### Requirement: A build refused for sign-in asks the learner to sign in

When the build server refuses a tutorial's build because nobody is signed in (an answer with reason `signed-out`), the act's result SHALL be a sign-in card, not a failed build. The card SHALL read "Sign in to build", with the line "Builds run on Playground's build server, which needs a GitHub sign-in. Your code stays in this browser.", and SHALL carry one primary action: "Sign in with GitHub" while nobody is signed in, "Build" once someone is. "Sign in with GitHub" SHALL sign in without leaving the page, and "Build" SHALL run the build act again. The card SHALL show no Explain and no "I'll fix it myself", and SHALL keep its reason across a reload. A build-and-deploy whose build is refused this way SHALL say "Sign in with GitHub to build." on its failed card.

#### Scenario: A signed-out learner presses Build (manual)
- **WHEN** a signed-out learner runs a tutorial's Build act and the build server answers with reason `signed-out`
- **THEN** the result card reads "Sign in to build" with the line above and one primary "Sign in with GitHub", and no Explain

#### Scenario: Signing in turns the primary into Build (manual)
- **WHEN** the learner signs in from that card
- **THEN** the tutorial stays on the same step and the card's primary reads "Build", which runs the build again

#### Scenario: A reload keeps the sign-in card (manual)
- **WHEN** the page reloads while that card is the step's latest result
- **THEN** the card still reads "Sign in to build", not "Build failed"

### Requirement: The airdrop act funds the wallet for the deploy

An airdrop act card SHALL be titled by its beat ("Get devnet SOL"), with the
context line "{short address} · {balance} SOL" and one primary button, its
beat's `button` ("Request airdrop"). It needs no sign-in. A press SHALL
request one devnet airdrop of the shortfall against the next deploy's cost
(priced on a 400 KB build while the build's length is unknown), plus fee
headroom, capped at the faucet's amount. It SHALL wait for the
balance to show it, and land with the record "Added {amount} SOL". The
terminal SHALL print "Airdropping {amount} SOL...".

When the lesson reaches the card and the wallet already holds the deploy's
cost, the card SHALL land without a press and without an airdrop, and the
lesson flows on. Only the lesson's first airdrop act, in beat order, SHALL
show that pass, with the record "Your wallet has {balance} SOL". A later
airdrop act SHALL stay out of the feed, its card and its say line both,
until the balance check answers: funded, it SHALL pass with no card, no say
line and no record, and the next card is the deploy's; short, a check
that failed, or one with no answer after 5 seconds SHALL show the card and
its say line as usual. A reload that
reaches the card again, never pressed, interrupted or refused, checks the
balance again.

With no wallet in the browser, the context line SHALL read "A new Playground
wallet, made in this browser", and the same press SHALL make the Playground
wallet, then airdrop, landing with the record "Made a wallet and added {amount}
SOL". The lesson never shows the deploy's "No wallet" card when it reaches the
airdrop card first; that card stays for the deploy as a fallback.

A refused or rate-limited airdrop, or one whose balance never moved, SHALL
post the red result card "Not enough devnet SOL" (`aria-label="Not enough
SOL"`), with the line "Your wallet has {balance} SOL, and this deploy needs
about {cost} SOL." followed by the cause. For a rate limit (a 429 or the
faucet's limit message) it SHALL read "The devnet faucet is at its limit for
now: try again in a minute, or top the wallet up yourself.", and for any other
failure "The airdrop didn't go through: try again in a minute, or top the
wallet up yourself." The cost is an estimate, rounded to two decimals ("about
2.81 SOL"); the balance keeps its exact figure. Under it sit "Your wallet" with the
short address and Copy, and "Open faucet" (`https://faucet.solana.com`, new
tab). A live airdrop card follows it, with the line "Asks the faucet again"
and the button "Try again".

The run SHALL report `tutorial_action_run` with `action: "airdrop"` and the
outcome `ok`, `no_wallet`, `no_funds`, `failed` or `interrupted`, like any act.

#### Scenario: A fresh wallet presses Request airdrop (manual)

- **WHEN** a learner with 0 SOL presses "Request airdrop" on Hello Anchor's
  airdrop card, and the faucet answers
- **THEN** the terminal prints "Airdropping {amount} SOL...", the card lands
  with "Added {amount} SOL", and the deploy card follows

#### Scenario: A funded wallet passes on its own (manual)

- **WHEN** the lesson reaches Hello Anchor's step 2 airdrop card with
  {balance} SOL in the wallet, at least the deploy's cost
- **THEN** no airdrop is requested, the card lands with "Your wallet has
  {balance} SOL", and the deploy card follows with no press

#### Scenario: A later deploy with a funded wallet shows no airdrop card (manual)

- **WHEN** Hello Anchor's step 4 reaches its airdrop act and the wallet holds
  the upgrade's cost
- **THEN** no airdrop card, say line or record shows, not even while the
  balance is checked, and the next card is "Build & deploy"

#### Scenario: A later deploy with a short wallet shows its airdrop card (manual)

- **WHEN** Hello Anchor's step 4 reaches its airdrop act and the wallet is
  short of the upgrade's cost, or the balance check fails
- **THEN** the say line "Your upgrade pays in devnet SOL too. Top the wallet
  up if it runs short." and the live "Get devnet SOL" card show

#### Scenario: A reload onto a refused airdrop checks again (manual)

- **WHEN** the faucet refused the airdrop, the learner tops the wallet up at
  faucet.solana.com and reloads the page
- **THEN** the balance is checked again, and the card passes with no press

#### Scenario: No wallet yet (manual)

- **WHEN** a fresh browser with no Playground wallet reaches the airdrop card
- **THEN** the context reads "A new Playground wallet, made in this browser",
  and one press of "Request airdrop" makes the wallet and lands with "Made a
  wallet and added {amount} SOL"

#### Scenario: The faucet refuses (manual)

- **WHEN** the faucet answers 429 to a press
- **THEN** the red "Not enough devnet SOL" card posts with the balance and the
  cost, and a live card "Asks the faucet again" with "Try again" follows it

### Requirement: The deploy does not fund the wallet

A tutorial deploy SHALL NOT request an airdrop. It SHALL check the wallet's
balance against the deploy's cost: before the build on the estimate only when
the last build's length is known and the build will not rerun, and after the
build on the real binary whenever that check was skipped or the binary
outgrew the estimate. An unknown length is never priced at the 400 KB default
to stop a deploy. When the balance is short, it SHALL stop before writing
the buffer and post the red "Not enough devnet SOL" card, with the wallet row
and "Open faucet" as the airdrop's, and the line "Your wallet has {balance}
SOL, and this deploy needs about {cost} SOL. Get devnet SOL from the faucet,
or top the wallet up yourself." The deploy never asked the faucet, so the
line does not say it is at its limit. The live deploy card that follows reads "Checks
your balance again, then deploys", with "Try again". The deploy card's stages
SHALL be Building (when stale), Writing buffer, Deploying and Confirming: there
is no "Funding your wallet" stage.

#### Scenario: A short wallet reaches the deploy (manual)

- **WHEN** a learner's wallet holds less than the deploy's cost at the deploy
- **THEN** no airdrop is requested, and the "Not enough devnet SOL" card posts
  with "Get devnet SOL from the faucet, or top the wallet up yourself.",
  followed by "Checks your balance again, then deploys"

#### Scenario: An upgrade of unknown length on a wallet that covers it (manual)

- **WHEN** Hello Anchor's step 4 builds and deploys an upgrade, the last
  build's length is unknown, and the wallet holds 2.98 SOL: short of the
  estimate on 400 KB, enough for the real binary
- **THEN** the deploy builds, checks the balance on the real binary, and
  upgrades the program

#### Scenario: A learner tops up from the faucet site and retries (manual)

- **WHEN** the learner funds the wallet at faucet.solana.com and presses "Try
  again"
- **THEN** the deploy checks the balance, finds it enough, and deploys

### Requirement: A call goal passes on the account it creates already existing

A step whose `call` goal names the account its instruction creates (`creates`) SHALL also pass when the goal's instruction is refused by the System Program because that account is already in use (its log line `Allocate: account ... already in use` or `Create Account: account ... already in use`, custom error 0x0). A call refused for any other reason SHALL fail as before. The call act, the client run and the Call panel SHALL pass the same goal.

#### Scenario: The Call panel's init_player on an existing player (manual)

- **GIVEN** Lumberjack's step 2, with a player this wallet created on an earlier walk
- **WHEN** the learner calls `initPlayer` from the Call panel and the System Program refuses it with "already in use"
- **THEN** step 2 passes, the step bar moves on, and nothing changes on chain

#### Scenario: A refusal for another reason (manual)

- **WHEN** on Lumberjack's step 2 the `init_player` call fails for a reason other than the account being in use
- **THEN** the step does not pass and the result is a failure, explained as any other

### Requirement: A client run passes when the account it would create exists

When a client run on a step whose `call` goal has `creates` sends no transaction, the runner SHALL derive the account's address from the seeds the step's IDL gives it for the goal's instruction, with the wallet and the deployed program, and read it. An account found there SHALL pass the goal. An account with no seeds in the IDL SHALL NOT be looked up, and the run SHALL stay "No transaction".

#### Scenario: client.ts finds the player (manual)

- **GIVEN** Lumberjack's step 2, with a player this wallet created on an earlier walk
- **WHEN** the learner runs `client.ts`, which finds the player and sends no transaction
- **THEN** step 2 passes

#### Scenario: client.ts sends nothing and no player exists (manual)

- **WHEN** a client run sends no transaction and no account is at the derived address
- **THEN** the result is "No transaction" and the step does not pass

### Requirement: An existing account reads as a pass, with the tutorial's explanation

A result that passed its goal because the account already exists SHALL show a passing outcome titled "Already exists" that names the account, on the result card and in the Call panel, never the red "Failed". Its card SHALL offer neither Explain nor "I'll fix it myself". The step's win SHALL show the definition's `existsLine` in place of `line` and `callPanelLine`, with the usual Next. A pass on a created account SHALL show `line` as before.

#### Scenario: A repeat walk of Lumberjack's step 2 (manual)

- **GIVEN** a player this wallet created on an earlier walk
- **WHEN** step 2 passes because the player already exists
- **THEN** the result reads "Already exists" with `player`
- **AND** the win explains that the player exists because this wallet ran the step before, that Anchor's `init` creates an account only once, and that the player keeps its wood and energy for the next step, then offers Next

#### Scenario: A first walk of Lumberjack's step 2 (manual)

- **WHEN** step 2 passes on a run that created the player
- **THEN** the win shows its usual line and no word of an existing account

### Requirement: The step's pass says it passed on an existing account

`tutorial_step_passed` SHALL carry `reason` with the value `"exists"` when the step passed because the account its goal creates already exists, and SHALL carry no `reason` on any other pass. Its other parameters (`tutorial`, `step_index`, `via`, `seconds`) are unchanged. A reload SHALL keep the reason with the step's pass.

#### Scenario: The event on an existing account (manual)

- **WHEN** Lumberjack's step 2 passes from the Call panel on an existing player
- **THEN** `tutorial_step_passed` fires once with `step_index` 2, `via` `call_panel` and `reason` `exists`

### Requirement: A one-time call on an existing account moves the lesson on

A `call` act whose `call` names `creates` SHALL send that account with its call, before any `creates` of the step's goal.
When the System Program refuses the act's instruction because that account is already in use, the run SHALL be recorded
refused, its result card SHALL say the account already exists on devnet, and the lesson SHALL post the next beat. The
step SHALL NOT pass on it unless its goal does. A refusal for any other reason, or for another account, SHALL stay a
failure, explained as any other.

#### Scenario: The counter's second pass (manual)

- **GIVEN** the counter fixture, finished once with this wallet
- **WHEN** the learner presses **Call initialize** on step 2 and the System Program refuses it with "already in use"
- **THEN** the card says `counter` already exists on devnet, the **Call increment** card posts, and step 2 passes only
  once `increment` lands

#### Scenario: A refusal for another reason (manual)

- **WHEN** the `initialize` act fails for a reason other than its account being in use
- **THEN** the run is a failure, explained as any other, and no further beat posts
