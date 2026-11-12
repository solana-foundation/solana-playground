# client-v2-deploy Specification

## Purpose

The Flow's Deploy stage puts the built program on the picked network from the
panel alone: it names who pays, shows the run's steps, asks its questions in
the panel, and keeps a history whose links open each record's network.

## Requirements

### Requirement: The stage names who pays

Before a deploy, the Deploy stage SHALL show one line naming the wallet that
pays: "From your Playground wallet · {short address} · {balance} SOL",
the address shortened in the middle. With no Playground wallet yet, the line
SHALL read "From your Playground wallet · free devnet SOL" on devnet, the
only network the design's line names, and "From your Playground wallet" on
every other network, whether or not it airdrops, and while the cluster is
unknown.
The deploy action SHALL stay pressable without a wallet once the program is
built. Inside a sentence the deploy action and every line of the stage SHALL
name the network in lower case ("Deploy to devnet", "Deployed to mainnet");
standalone labels (pickers, chips, Explorer links) keep it capitalised.

#### Scenario: No wallet yet (manual)

- **WHEN** a browser with no Playground wallet opens the built Deploy stage
- **THEN** the who-pays line reads "From your Playground wallet · free devnet
  SOL" and "Deploy to devnet" is pressable

### Requirement: A deploy from the stage creates the wallet it needs

When the user presses the stage's deploy action and no wallet is connected,
the stage SHALL connect the Playground wallet before the deploy runs: the
first existing account, or a new account when the browser has none. No
dialog and no terminal question SHALL appear for it. A deploy typed in the
terminal SHALL keep the terminal's connect question.

#### Scenario: First deploy in a fresh browser (manual)

- **WHEN** a fresh browser builds the program and presses "Deploy to devnet"
- **THEN** a Playground wallet exists afterwards and no wallet dialog or
  terminal question appeared

### Requirement: The stage shows the run as steps

While a deploy started from the stage or the terminal runs, the stage SHALL
show, above its held deploy action, a progress region (`role="status"`,
`aria-label="Deploy progress"`) listing the steps in order: "Funding wallet"
(only when the run funds the wallet), "Preparing buffer", "Writing program,
{percent}%" and "Deploying" ("Upgrading" when the program exists). Each step
SHALL read as done, running or waiting. The terminal SHALL keep printing its
own lines.

#### Scenario: Steps of a first deploy (manual)

- **WHEN** a funded wallet deploys a program for the first time on devnet
- **THEN** the progress region shows "Preparing buffer", then "Writing
  program" with a rising percent, then "Deploying", and no "Funding wallet"

### Requirement: The stage funds the wallet only when the user asks

The Playground SHALL NOT request an airdrop the user did not ask for:
`wallet.automaticAirdrop` ("Automatic airdrop" in Settings) SHALL default to
off. When a deploy started from the stage finds the wallet's balance below
what the deploy needs, the run SHALL stop before anything is sent and the
stage SHALL show a "Not enough devnet SOL" card (`role="alert"`,
`aria-label="Not enough SOL"`; the title names the network) with the
balance, the amount needed, the wallet address with copy, a reason and
"Open faucet" (opens `https://faucet.solana.com` in a new tab, devnet and
testnet only). The reason and the card's first action SHALL be:

- on a network with a faucet while automatic airdrop is off: "Request devnet
  SOL from the faucet, or send SOL to the wallet below." and "Request
  airdrop", which runs the deploy again and requests the airdrop;
- when a public faucet needs a session and the user is signed out: "Sign in
  with GitHub to request devnet SOL." and "Sign in", after which the deploy
  runs again and requests the airdrop;
- on a network without a faucet: "This network has no faucet. Send SOL to
  the wallet below." and "Try again" (runs the deploy again);
- when the airdrop fails: "The faucet did not send SOL.", the faucet's
  answer, and "Try again" (runs the deploy again and requests the airdrop
  again);

An airdrop the run requests, on that press, or without a question when the
user turned automatic airdrop on, SHALL be the shortfall plus fee headroom,
capped at the network's faucet amount, and the stage SHALL show "Funding
wallet" as the first step. A deploy typed in the terminal SHALL keep its
airdrop question.

#### Scenario: Short wallet with automatic airdrop off (manual)

- **WHEN** a signed-in user with 0 SOL deploys on devnet from the stage with
  the default settings
- **THEN** the "Not enough SOL" card shows "Request airdrop", no airdrop is
  requested and the terminal asked nothing; pressing "Request airdrop"
  shows "Funding wallet" and deploys

#### Scenario: Airdrop refused (manual)

- **WHEN** a wallet with 0 SOL deploys on devnet from the stage, the user
  presses "Request airdrop", and the faucet refuses the airdrop
- **THEN** the "Not enough SOL" card shows the balance, the amount needed,
  the address, "Try again" and "Open faucet", and the terminal asked nothing;
  pressing "Try again" requests the airdrop again, with automatic airdrop off

### Requirement: A failed last build asks in the panel

When the last build failed and a deploy is started from the stage, the stage
SHALL ask in a dialog titled "The last build failed", with "Deploy last
build" and "Cancel", before anything is sent. "Cancel" SHALL stop the deploy
with nothing sent and no failure shown; "Deploy last build" SHALL deploy the
last good build. The terminal SHALL NOT ask the same question for that
run.

#### Scenario: Cancel the stale deploy (manual)

- **WHEN** the last build failed and the user presses Deploy, then "Cancel"
- **THEN** no transaction is sent and the stage shows no failure callout

### Requirement: The result card says what happened and what it cost

After a successful deploy, the stage SHALL show a result card (`role="status"`,
`aria-label="Deploy result"`) headed "Deployed to {network}" for a first
deploy and "Upgraded. The program id stays the same." for an upgrade. The
card SHALL show the program id shortened in the middle with a copy button,
"Cost {amount} SOL" (the SOL the paying wallet spent on the run, fees
included; omitted for a record without one), the time, "View on Explorer
({network})" and, when the record has a signature, "Transaction
({network})". Every Explorer link SHALL name the record's network in its
label and open that network.

#### Scenario: Upgrade result (manual)

- **WHEN** a deployed program is redeployed from the stage
- **THEN** the card reads "Upgraded. The program id stays the same." and
  shows a cost

### Requirement: The backup line shows once per wallet

After a successful deploy paid by a Playground wallet, the result card SHALL
show a backup line (`aria-label="Keypair backup"`): "Your program on
{network} is tied to this browser's Playground wallet. Save the keypair so you
can update it from another browser.", `{network}` lowercase ("devnet"), with
"Save keypair" and "Not now". "Save
keypair" SHALL download the wallet's keypair file and hide the line for that
wallet; "Not now" SHALL hide it for that wallet. The choice SHALL be kept per
wallet address in this browser.

#### Scenario: Not now sticks (manual)

- **WHEN** the user presses "Not now" and deploys again with the same wallet
- **THEN** the backup line does not show

### Requirement: History links open each record's network

Each history record SHALL keep the network it was deployed to, the deploy's
transaction signature and its cost. Each row's Explorer link SHALL open the
record's network, whatever network is picked now, and its accessible name
SHALL name the deployment and that network capitalised ("View deployment
({program id}) on Explorer (Devnet)"). On a desk the link's text SHALL read
"Explorer (Devnet)"; on a phone it SHALL read "Explorer", since the row names
its network. Records written without a signature or cost SHALL still list.

#### Scenario: A devnet record viewed on testnet

- **WHEN** the history holds a devnet record and the picked network is testnet
- **THEN** that row's Explorer link reads "Explorer (Devnet)" and its address
  carries `cluster=devnet`

#### Scenario: A history link on a phone (manual)

- **WHEN** a 390 px wide screen shows a devnet record in the history
- **THEN** its link reads "Explorer" and is named "View deployment ({program
  id}) on Explorer (Devnet)"

### Requirement: The assistant's approvals ask with the cost

The assistant's approval card for a deploy SHALL be titled "Deploy {program}
to {network}? It costs about {cost} {network} SOL from your Playground
wallet.", with `{network}` lowercase ("devnet"), where `{cost}` is estimated
from the built program's size. When a connected wallet, not the Playground
wallet, pays, the sentence SHALL end "from your wallet.". While the network is
unknown, the question SHALL name "the network" and the cost SHALL read plain
"SOL" ("It costs about {cost} SOL from …"). When no estimate is available the
second sentence SHALL be left out. The card for a build SHALL be titled "Build
{program}?". `{program}` is the project's name.

#### Scenario: Deploy approval names the cost (manual)

- **WHEN** the assistant asks to deploy a built program on devnet, paid by the
  Playground wallet
- **THEN** the card reads "Deploy {project} to devnet? It costs about
  {cost} devnet SOL from your Playground wallet." with Allow and Deny

### Requirement: Deploy events

The `features/deploy` slice SHALL emit, with prefix `deploy`:

- `deploy_started` when a deploy starts from the stage, with `cluster` (the
  network's name) and `redeploy` (boolean);
- `deploy_succeeded` when it finishes, with `cluster` and `redeploy`;
- `deploy_failed` when it stops with an error, with `cluster` and `step`
  (`funding`, `buffer`, `write`, `deploy`, `checks`);
- `deploy_sol_needed_shown` when the "Not enough SOL" card shows, with
  `cluster` and `reason` (`signed_out`, `no_faucet`, `airdrop_off`,
  `airdrop_failed`);
- `deploy_backup_shown`, `deploy_backup_saved` and `deploy_backup_dismissed`
  for the backup line, with no parameters.

No event SHALL carry an address, a program id, a signature or an amount.

#### Scenario: Events of a stage deploy (manual)

- **WHEN** a deploy from the stage succeeds
- **THEN** `deploy_started` and `deploy_succeeded` are sent with the same
  `cluster`

### Requirement: The facts of a first deploy sit in one card

Before the first deploy on the network picked (Spec 08's EMPTY-03), the Deploy
stage SHALL show the deploy's facts as rows of one card, under the title and
its line: a row named "Network" with the network's name and a "Change" link
that opens the settings on the network choice; a row named "IDL" with the
loaded IDL's program name, only while an IDL is loaded; once the program is
built and no deploy runs, the who-pays line of "The stage names who pays"; and
last, the program id, which unfolds into its keypair. The card SHALL leave out
the Network row while the cluster is unknown. After a deploy on the network
picked, the stage SHALL keep a card under the history with the IDL row, when an
IDL is loaded, and the program id.

#### Scenario: A built program before its first deploy (manual)

- **WHEN** a built project with a loaded IDL named "counter" opens the Deploy
  stage on devnet with no deployment there
- **THEN** one card lists Network "Devnet" with Change, IDL "counter", the
  who-pays line and the program id, in that order

#### Scenario: Change opens the network choice (manual)

- **WHEN** the user presses Change in the card's Network row
- **THEN** the settings open with focus on the network choice

### Requirement: A network with no deploy names where the others are

When the network picked has no deployment of the project and another network
has one (Spec 08's EMPTY-14), the Deploy stage, once the program is built and
the network is known, SHALL title itself "Nothing on {network}" and SHALL say
"This project has deploys on {other network}." with "Show {other network}" as a
link when the settings offer that network. Pressing the link SHALL switch the
connection to that network. The link SHALL be off while a deploy runs, because
a deploy stays on the network it started on (see "A deploy stays on the network
it started on") and the stage would then show another one.

#### Scenario: Deployed on devnet, mainnet picked (manual)

- **WHEN** the project has a devnet deployment and the picked network is
  mainnet
- **THEN** the title reads "Nothing on mainnet" and the line "This project has
  deploys on devnet. Show devnet"

#### Scenario: The switch waits for a running deploy (manual)

- **WHEN** a deploy runs on the network picked
- **THEN** "Show {other network}" is disabled

### Requirement: A deploy stays on the network it started on

A deploy SHALL send, simulate and confirm every transaction of its run on the
connection it took when it started, and its record and `deploy_succeeded`
SHALL name that connection's network, whatever network is picked while it runs.
The airdrop is the exception: the faucet funds the network picked now, so a
deploy that needs SOL SHALL end with "The network changed during the deploy,
so an airdrop would fund another network. Deploy again." when the endpoint
changed since it started, before it asks the faucet. When the starting
connection's network cannot be read (a custom endpoint whose genesis hash does
not answer), the run's network SHALL be unknown: the deploy goes on, and SHALL
add no history record and send no `deploy_succeeded`, rather than name the
network selected now. The scenarios are held by unit tests
(`deploy-run.test.ts`, `bpf-loader-upgradeable.test.ts`, `deploy-history.test.ts`,
`Deploy.test.tsx`).

#### Scenario: The network changes during the first reads (manual)

- **WHEN** the endpoint changes while a deploy reads its balance
- **THEN** the buffer, its writes and the deploy or upgrade are sent and
  confirmed on the starting network, and the record names it

#### Scenario: The network changes before an airdrop (manual)

- **WHEN** a deploy that needs SOL finds the endpoint changed since it started
- **THEN** it ends with the network-changed error and requests no airdrop

#### Scenario: The run's network cannot be read (manual)

- **WHEN** a deploy succeeds on a custom endpoint whose network cannot be read
- **THEN** the history gets no record and no `deploy_succeeded` is sent
