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
- on failure, the failed card of `tutorial-conversation` with the first
  compiler error's code, file, line and column, read from the server's log.

An unreachable server SHALL post a failed card "Build server unreachable",
which offers "Try again". A failure the server's output cannot place on a
line SHALL show the log, with no line link.

#### Scenario: The planned failure is a real compiler error

- **WHEN** Hello Anchor's step 1 builds before the fixing question
- **THEN** the build server answers with `error[E0412]: cannot find type `Hello` in this scope` at `src/lib.rs:9:32`
- **AND** the card reads "E0412 · line 9" and line 9 is marked

### Requirement: Deploy goes from the learner's wallet on devnet

A deploy act SHALL deploy the last successful build to devnet through the BPF
upgradeable loader, paid by the learner's Playground wallet. Its stages are
"Writing buffer", "Deploying" and "Confirming". "Building" comes before them
when the program changed since the last build, and "Funding your wallet" first
of all when the balance is short; "n of m" counts every stage shown, three to
five. The IDL does not go on chain yet: Anchor 1.x publishes it through the
Program Metadata Program, which Playground does not call, and nothing in a
tutorial reads it from the chain (Slava, 3 Nov; a follow-up ticket brings the
stage back). The first deploy SHALL write the program id into `declare_id!` and light
that line. Before the first deploy:

- **No wallet:** the act card SHALL offer to create or connect one in place,
  and run nothing until there is one.
- **Too little balance:** the deploy SHALL top up the wallet by airdrop, the
  way the editor's deploy does, as an extra first stage on the act card,
  "Funding your wallet". The stage shows only when the balance is short, and
  the terminal prints the airdrop line. There is no separate card. The top-up
  needs no sign-in: the editor's `airdrop` command keeps its GitHub gate, but
  a tutorial promises a wallet with free test SOL (Slava, 3 Nov).
- **Airdrop refused or rate limited:** a failed result card SHALL post, red
  like a failed build, titled "Not enough devnet SOL", with the line "Your
  wallet has {balance} SOL, this deploy needs about {cost}. The devnet faucet
  is at its limit for now". Under it sits the wallet's address row (short
  address, Copy). Its buttons are a primary "Try again" and "Open faucet",
  which opens `https://faucet.solana.com` in a new tab. Typing "deploy" in the
  composer retries too.

A deploy SHALL keep the program's keypair in the workspace, so the program
keeps its address. Every later deploy of that tutorial's program SHALL upgrade
it in place. The result card SHALL read "Deployed" (or "Upgraded <short id>"),
with "Show log" opening the terminal, and:

- the devnet SOL the deploy spent (left out for a deploy recognised from the
  chain after a reload, whose cost is not known);
- on its meta line, the program id and the deploy signature, each a short key
  with ↗ that is itself the Explorer link, with no separate Explorer button;
- the IDL's instructions and their arguments.

In a receipt (the finish card's Transaction details), every address row SHALL
carry Copy and an Explorer link. Every Explorer link SHALL open Solana
Explorer on the devnet cluster in a new tab.

#### Scenario: First deploy with an empty wallet

- **WHEN** a learner with a new wallet and 0 SOL presses Deploy on Hello
  Anchor's step 2
- **THEN** the card shows "Funding your wallet" (1 of 4), then the three
  deploy stages to "4 of 4"
- **AND** the result's meta line shows the program id and the deploy
  signature as links to `https://explorer.solana.com/...?cluster=devnet`

#### Scenario: The faucet is at its limit

- **WHEN** the deploy's airdrop is refused
- **THEN** a red card reads "Not enough devnet SOL" with the wallet's balance,
  the deploy's cost, the address row with Copy, "Try again" and "Open faucet"
- **AND** typing "deploy" runs the deploy again

#### Scenario: The upgrade keeps the address

- **WHEN** step 4's build and deploy lands
- **THEN** the result reads "Upgraded" with the same program id as step 2
- **AND** its IDL line reads `hello(name: string)`

### Requirement: Client runs and calls send real transactions

A run act SHALL run the client file with Playground's client runner, the
program and the wallet bound as the editor's Run binds them. The terminal
SHALL show the runner's output. The result card SHALL show:

- the transactions the run sent and their confirmation;
- the program's log line the definition names (for Hello Anchor, the first
  line starting `Program log: Hello`), as the card's large line;
- on its meta line, the signature as a short key with ↗ that is the Explorer
  link, the compute units, the fee and the confirmation time.

A call act SHALL send the instruction with the given arguments from the
wallet and post the same card with "Sent from the chat". A Call panel call
SHALL send it the same way and show the card in the panel (see
`tutorial-workspace`). A transaction that fails SHALL post a failed card with
its error and its log, and the step SHALL not pass.

#### Scenario: Hello from devnet

- **WHEN** the learner runs `client.ts` on step 3 with the picked line
- **THEN** the result reads "Confirmed · Sent from client.ts" with "Program
  log: Hello, World!"
- **AND** its signature opens the transaction in Explorer on devnet

### Requirement: Wallet copy replaces every Kora line

No copy in a tutorial SHALL name Kora, promise 0 SOL or mention closing
programs after 7 days. The definition and the cards SHALL use these strings,
Almaz's of 28 Oct, verbatim. `{cost}` and `{fee}` are the real numbers from
the deploy and the transaction.

| Where                       | String                                                                                                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Intro note                  | A devnet wallet is set up for you with free test SOL. Your progress stays in this browser                                                                                                |
| Deploy explanation (step 2) | Deploying costs devnet SOL. It's test money with no value, and Playground tops your wallet up for free when it runs low                                                                  |
| Deploy card context line    | From your Playground wallet · free devnet SOL                                                                                                                                            |
| Deploy result               | {cost} devnet SOL from your wallet                                                                                                                                                       |
| Terminal                    | Deploying from {wallet short} · {cost} SOL                                                                                                                                               |
| Call result and Call panel  | fee {fee} from your wallet                                                                                                                                                               |
| Receipt signer row          | Your wallet · signer, with its short address                                                                                                                                             |
| Finish card meta            | {N} steps · {time} · devnet only, nothing real spent                                                                                                                                     |
| Finish receipt              | Fee {fee} devnet SOL                                                                                                                                                                     |
| Finish chip                 | What is devnet SOL?                                                                                                                                                                      |
| Its answer                  | Devnet is Solana's public test network. Its SOL is free and worth nothing, so you can deploy and call as much as you like. Playground keeps your wallet topped up from the devnet faucet |

There SHALL be no "Why 7 days?" chip.

#### Scenario: No Kora left

- **WHEN** Hello Anchor runs from the intro to the finish
- **THEN** no card, chip, terminal line or receipt reads "Kora", "0 SOL" or
  "7 days"
- **AND** the deploy result reads "{cost} devnet SOL from your wallet" with
  the real cost

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

#### Scenario: Passing step 3 from the Call panel

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

#### Scenario: Editing lib.rs after the deploy

- **WHEN** after step 2 the learner changes the `msg!` text in `lib.rs`
- **THEN** one nudge with "Build and deploy" posts at the live point
- **AND** the next call's log shows the new text only after that deploy lands

### Requirement: A reload interrupts a run, never repeats it

A run in flight at a reload SHALL not resume. Its act card SHALL come back
idle with "Interrupted by a reload. Run it again.". A deploy whose transaction
confirmed before the reload SHALL be recognised from the chain. Its result
then posts instead, so pressing Deploy again never deploys a second program
for the same tutorial.

#### Scenario: Reload mid-deploy

- **WHEN** the learner reloads during "Deploying"
- **THEN** the act card shows "Interrupted by a reload. Run it again."
- **AND** running it again upgrades the same program id

### Requirement: Runs are measured

The tutorial slice SHALL emit `tutorial_action_run` when an act or a Call panel call
ends, and once for each run a reload interrupted (`outcome: "interrupted"`,
`seconds: 0`); a deploy recognised from the chain instead counts as `ok`. Its
parameters:

- `tutorial`: the slug;
- `step`: 1 to 6;
- `action`: `build`, `deploy`, `build_deploy`, `run`, `call` (the call act)
  or `call_panel` (a Call panel call);
- `outcome`: `ok`, `failed`, `interrupted`, `no_wallet` or `no_funds`;
- `seconds`: the run's duration.

Failures SHALL also be logged through the logger with the error, never with a
key or the wallet's secret.

#### Scenario: A refused airdrop

- **WHEN** a deploy stops because the airdrop was refused
- **THEN** `tutorial_action_run` reaches the memory provider with `action: "deploy"` and `outcome: "no_funds"`
