# Spec Delta

## Purpose

What a conversation tutorial's act cards and Call panel actually do. They
build on Playground's build server, deploy and upgrade from the learner's
wallet on devnet, run the client, and call the program, with Explorer links on
every result. What happened decides when a step passes.

## ADDED Requirements

### Requirement: Build runs on Playground's build server

A build act SHALL send the workspace's program files to the build server the
learner's settings name, the same way the editor's Build does. Its stages:

- "Building" while the server compiles;
- on success, a result card "Build successful" with the IDL's instruction
  count and names and the real build time;
- on failure, the failed card of `tutorial-conversation` with one compiler
  error's code, file, line and column, read from the server's log.

The card's error SHALL be the one that holds the step's `failsWith` line when
the log has it, else the first error that is not a macro symptom: an error
inside `#[program]` that names `__client_accounts`, `__cpi_client_accounts`
or a `…Bumps` type is only the echo of another, as the editor's improved
output already treats it. An error with no code counts like one with a code.
The server's `Error: Function … Stack offset` lines are never errors.

An unreachable server SHALL post a failed card "Build server unreachable"
with "Build couldn't start. The Playground server didn't answer. Your code is
unchanged.", which offers "Try again". A failure the server's output cannot
place on a line SHALL show the log, with no line link.

#### Scenario: The planned failure is a real compiler error (manual)

- **WHEN** Hello Anchor's step 1 builds before the fixing question
- **THEN** the build server answers with `error[E0432]` at `src/lib.rs:5:1`, whose log holds
  ``could not find `__client_accounts_hello` ``
- **AND** the card reads "E0432 · line 5" and line 5 is marked

### Requirement: Deploy goes from the learner's wallet on devnet

A deploy act SHALL deploy the last successful build to devnet through the BPF
upgradeable loader, paid by the learner's Playground wallet. Its stages are
"Writing buffer", "Deploying" and "Confirming". "Building" comes before them
when the program changed since the last build; "n of m" counts every stage
shown, three or four. There is no "Funding your wallet" stage: the deploy
never funds the wallet (change `tutorial-airdrop-step`, HOO-2677). The IDL does not go on chain yet: Anchor 1.x publishes it through the
Program Metadata Program, which Playground does not call, and nothing in a
tutorial reads it from the chain (Slava, 3 Nov; a follow-up ticket brings the
stage back). The first deploy SHALL write the program id into `declare_id!` and light
that line. A deploy that cannot be paid for:

- **No wallet:** the deploy SHALL run nothing and post a red result card,
  "No wallet", with the line "A deploy pays from a Playground wallet. Create
  one in this browser and the deploy runs." and "Create wallet", which makes
  the Playground wallet and runs the deploy again. There is no connect
  option: a tutorial deploys from the Playground wallet, never an
  extension's.
- **Too little balance:** the deploy SHALL NOT fund the wallet. The airdrop
  act before every deploy act does, with no sign-in, and passes by itself
  when the wallet already holds enough (change `tutorial-airdrop-step`,
  HOO-2677). A deploy that still finds the wallet short, on the estimate
  before the build or on the real binary, SHALL stop before writing the
  buffer and post the red result card "Not enough devnet SOL".
- **Not enough devnet SOL:** the card is red like a failed build, with the
  line "Your wallet has {balance} SOL, and this deploy needs about {cost}
  SOL. Get devnet SOL from the faucet, or top the wallet up yourself." Under
  it sit "Your wallet" with the short address and Copy, and "Open faucet",
  which opens `https://faucet.solana.com` in a new tab. The card has no Try again, and the act that hit it draws no
  record over it: a live deploy act card follows it, "Checks your balance
  again, then deploys" with the button "Try again" (Almaz's prototype, 3
  Nov). A refused airdrop posts the same card, whose line ends "The devnet
  faucet is at its limit for now: try again in a minute, or top the wallet up
  yourself.", followed by its own live card, "Asks the faucet again". A deploy that failed otherwise draws no record
  either and gets the same Try again card with the act's own line. Typing
  "deploy" in the composer retries too.

A deploy SHALL keep the program's keypair in the workspace, so the program
keeps its address. Every later deploy of that tutorial's program SHALL upgrade
it in place. The result card SHALL be one row, "Deployed to devnet" (or
"Upgraded <short id>"), and a chevron that opens its details, as Almaz's
prototype draws it (3 Nov; where the prototype's table and its code differ,
the code wins):

- one sentence of where the program lives and what the deploy took, "Your
  program now lives on devnet at <short id>. The deploy took 5.6 s and
  {cost} test SOL from your wallet." ("Your program at <short id> now runs
  the new code. The upgrade took ..." for an upgrade, "The build and deploy
  took ..." for a first build-and-deploy); the cost is left out
  for a deploy recognised from the chain after a reload, whose cost is not
  known;
- then one row of quiet controls: Copy id, Explorer (the program), the
  deploy's Transaction on Explorer, and Log, which opens the terminal.

Keys on the deploy cards and in the terminal read six and six
(`9hJqVk…FxCvBz`).

A deploy act's context may name the program as `{program}`, which the card
fills with its short id, or "your program" before a build gives it one. The
terminal bar and the drawer follow a tutorial's deploy as they follow the
editor's: "Deploying" while it runs, the drawer opening on the first deploy,
and amber after an edit; the stage stays on the editor.

In a receipt (the finish card's Transaction details), every address row SHALL
carry Copy and an Explorer link. Every Explorer link SHALL open Solana
Explorer on the devnet cluster in a new tab.

#### Scenario: First deploy with an empty wallet (manual)

- **WHEN** a learner with a new wallet and 0 SOL presses "Request airdrop",
  then Deploy, on Hello Anchor's step 2
- **THEN** the airdrop card lands with "Added {amount} SOL", and the deploy
  card shows its three deploy stages to "3 of 3", with no "Funding your wallet"
- **AND** the result's details link the program and the deploy's
  transaction to `https://explorer.solana.com/...?cluster=devnet`

#### Scenario: The faucet is at its limit

- **WHEN** the airdrop before the deploy is refused
- **THEN** a red card reads "Not enough devnet SOL" with the wallet's balance,
  the deploy's cost, the address with Copy, and "Open faucet"
- **AND** an airdrop act card under it, "Asks the faucet again" with "Try
  again", asks the faucet again, and the deploy card follows once it pays

#### Scenario: The upgrade keeps the address (manual)

- **WHEN** step 4's build and deploy lands
- **THEN** the result reads "Upgraded" with the same program id as step 2
- **AND** its details read "Your program at <short id> now runs the new code."

### Requirement: Client runs and calls send real transactions

A run act SHALL run the client file with Playground's client runner, the
program and the wallet bound as the editor's Run binds them. The terminal
SHALL show the runner's output. The result card, as Almaz's tutorial-v2
prototype draws it, SHALL show:

- a head reading "Confirmed" with the instruction it called, in mono, as
  its meta ("from client.ts", or "from the chat" for a call act, when no
  instruction decoded);
- under the head, in view, the program's log line the definition names (for
  Hello Anchor, the first line starting `Program log: Hello`);
- behind the head's chevron, one sentence ("client.ts ran in {s} and called
  `hello`. It used {n} compute units, and the fee was {fee} test SOL from
  your wallet."), then Copy signature, Explorer ↗ (the transaction on
  devnet) and Log.

A call act SHALL send the instruction with the given arguments from the
wallet and post the same card. A Call panel call SHALL send it the same way
and show the card in the panel (see `tutorial-workspace`). A transaction
that fails SHALL post a failed card, "Run failed" or "Call failed", whose
meta is the program's error ("NotEnoughEnergy · error 6000") or else the
plain reason, with the error line and the reason in view and the log behind
the chevron; the step SHALL not pass. A run that sent no transaction SHALL
post "No transaction", "client.ts sent none · see the terminal", not red,
and the step SHALL not pass. A transaction that was sent but that devnet
did not read back in the read window SHALL post "Not confirmed yet ·
<short signature> ↗", not red, the short signature linking to the
transaction in Explorer, the reason in its body, and, while it is the live
result, "Check again". Check again SHALL read the same
signatures again and send nothing; once they read back, the result SHALL be
the one they landed with and the goal SHALL be judged on it.

#### Scenario: A slow devnet confirms late

- **WHEN** the learner's call on step 4 is sent and devnet has not read it
  back when the read window ends
- **THEN** the result reads "Not confirmed yet" and the step does not fail
- **AND** "Check again", once devnet has the transaction, posts "Confirmed"
  and passes the step without sending a second transaction

#### Scenario: Hello from devnet (manual)

- **WHEN** the learner runs `client.ts` on step 3 with the picked line
- **THEN** the result reads "Confirmed" with `hello` and "Program log:
  Hello, World!"
- **AND** its details' Explorer link opens the transaction in Explorer on
  devnet

### Requirement: Wallet copy replaces every Kora line

No copy in a tutorial SHALL name Kora, promise 0 SOL or mention closing
programs after 7 days. The definition and the cards SHALL use these strings,
Almaz's of 28 Oct, verbatim, except the three lines on topping the wallet
up, which are Design alignment's of 6 Nov: the learner's own airdrop act
pays before the first deploy, and a busy faucet sends them to
faucet.solana.com (change `tutorial-airdrop-step`). `{cost}` and `{fee}` are the real numbers from the deploy
and the transaction.

| Where                       | String                                                                                                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Intro note                  | A devnet wallet is set up for you, and you get free test SOL for it before the first deploy. Your progress stays in this browser |
| Deploy explanation (step 2) | It costs devnet SOL, test money with no value. You get it from the devnet faucet with one button before the deploy, and if the faucet is busy, at faucet.solana.com. |
| Deploy card context line    | From your Playground wallet · free devnet SOL                                                                                                                                            |
| Deploy result               | {cost} test SOL from your wallet                                                                                                                                                         |
| Terminal                    | Deploying from {wallet short} · {cost} SOL                                                                                                                                               |
| Call result and Call panel  | It used {n} compute units, and the fee was {fee} test SOL from your wallet                                                                                                               |
| Receipt signer row          | Your wallet · signer, with its short address                                                                                                                                             |
| Finish card meta            | {N} steps · {time} · devnet only, nothing real spent                                                                                                                                     |
| Finish receipt              | Fee {fee} devnet SOL                                                                                                                                                                     |
| Finish chip                 | What is devnet SOL?                                                                                                                                                                      |
| Its answer                  | Devnet is Solana's public test network. Its SOL is free and worth nothing, so you can deploy and call as much as you like. You get it from the devnet faucet with one button; if the faucet is busy, get some yourself at faucet.solana.com. |

There SHALL be no "Why 7 days?" chip.

#### Scenario: No Kora left (manual)

- **WHEN** Hello Anchor runs from the intro to the finish
- **THEN** no card, chip, terminal line or receipt reads "Kora", "0 SOL" or
  "7 days"
- **AND** the deploy result's details read "{cost} test SOL from your
  wallet" with the real cost

### Requirement: A step passes on what happened

Each step's goal in the definition SHALL be checked against a real result:

- **`build`:** a build of the step's main file succeeds and its IDL holds the
  instructions the step's target defines.
- **`deploy`:** a deploy lands.
- **`call`:** a transaction calling the named instruction confirms on the
  deployed program. Its log holds the named line. Every argument the goal
  requires is non-empty, and the call is made on the program built from the
  target, so a call before the upgrade does not pass an argument goal.

A call from the client run, the call act or the Call panel SHALL pass the same
goal. A call outside a step's goal (on a win, after the finish) SHALL show its
result and pass nothing. A passed step SHALL stay passed. No step SHALL pass on
the learner's word alone.

#### Scenario: Passing step 3 from the Call panel (manual)

- **WHEN** with Hello Anchor's step 3 question still open the learner calls
  `hello` from the Call panel
- **THEN** the panel shows the result and step 3's win follows in the feed
  with the definition's Call line and "Write it in client.ts"
- **AND** the open question's record reads "· skipped, called from the Call
  panel" after Next

### Requirement: A changed deployed file asks for a redeploy

When a file of a deployed program changes (whitespace aside) after its last
deploy, a nudge SHALL post at the live point: "You changed <file> after
deploying. Devnet still runs the old version." The nudge comes with a "Build
and deploy" act, and the deploy step's segment gets an amber dot until a
deploy lands. Further edits SHALL update that one nudge, never add another.
The current step's goal SHALL stay as it is.

#### Scenario: Editing lib.rs after the deploy (manual)

- **WHEN** after step 2 the learner changes the `msg!` text in `lib.rs`
- **THEN** one nudge with "Build and deploy" posts at the live point
- **AND** the next call's log shows the new text only after that deploy lands

### Requirement: A reload interrupts a run, never repeats it

A run in flight at a reload SHALL not resume. Its act card SHALL come back
idle with "Interrupted by a reload. Run it again.". A deploy whose transaction
confirmed before the reload SHALL be recognised from the chain. Its result
then posts instead, so pressing Deploy again never deploys a second program
for the same tutorial.

#### Scenario: Reload mid-deploy (manual)

- **WHEN** the learner reloads during "Deploying"
- **THEN** the act card shows "Interrupted by a reload. Run it again."
- **AND** running it again upgrades the same program id

### Requirement: Runs are measured

The tutorial slice SHALL emit `tutorial_action_run` when an act or a Call panel call
ends, and once for each run a reload interrupted (`outcome: "interrupted"`,
`seconds: 0`); a deploy recognised from the chain instead counts as `ok`. Its
parameters:

- `tutorial`: the slug;
- `step_index`: 1 to 6;
- `action`: `airdrop`, `build`, `deploy`, `build_deploy`, `run`, `call` (the
  call act) or `call_panel` (a Call panel call);
- `outcome`: `ok`, `failed`, `interrupted`, `no_wallet`, `no_funds` or
  `unconfirmed` (sent, devnet has not read it back yet);
- `seconds`: the run's duration.

Failures SHALL also be logged through the logger with the error, never with a
key or the wallet's secret.

#### Scenario: A refused airdrop (manual)

- **WHEN** the faucet refuses the airdrop act before a deploy
- **THEN** `tutorial_action_run` reaches the memory provider with `action: "airdrop"` and `outcome: "no_funds"`
