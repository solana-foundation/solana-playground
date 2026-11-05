# Spec Delta

## Purpose

The Flow's Deploy stage puts the built program on the picked network from the
panel alone: it names who pays, shows the run's steps, asks its questions in
the panel, and keeps a history whose links open each record's network.

## ADDED Requirements

### Requirement: The stage names who pays

Before a deploy, the Deploy stage SHALL show one line naming the wallet that
pays: "Deploys from your Playground wallet · {short address} · {balance} SOL",
the address shortened in the middle. With no Playground wallet yet, the line
SHALL read "Deploys from a Playground wallet created on your first deploy."
The deploy action SHALL stay pressable without a wallet once the program is
built.

#### Scenario: No wallet yet (manual)

- **WHEN** a browser with no Playground wallet opens the built Deploy stage
- **THEN** the who-pays line says a wallet is created on the first deploy and
  "Deploy to devnet" is pressable

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

### Requirement: The stage funds the wallet without asking

When a deploy started from the stage finds the wallet's balance below what
the deploy needs, on a network with a faucet, it SHALL request an airdrop of
the shortfall plus fee headroom, capped at the network's faucet amount,
without a question, and show "Funding wallet" as the first step. On a
network without a faucet, or when the airdrop fails, the run SHALL stop and
the stage SHALL show a "Not enough devnet SOL" card (`role="alert"`,
`aria-label="Not enough SOL"`; the title names the network) with the
balance, the amount needed, the wallet address with copy, the airdrop's
reason, "Try again" (runs the deploy again) and "Open faucet" (opens
`https://faucet.solana.com` in a new tab, devnet and testnet only). When the
reason is that the user is signed out, the card SHALL offer "Sign in with
GitHub" in place of "Try again". A deploy typed in the terminal SHALL keep
its airdrop question.

#### Scenario: Airdrop refused (manual)

- **WHEN** a wallet with 0 SOL deploys on devnet from the stage and the
  faucet refuses the airdrop
- **THEN** the "Not enough SOL" card shows the balance, the amount needed,
  the address, "Try again" and "Open faucet", and the terminal asked nothing

### Requirement: A failed last build asks in the panel

When the last build failed and a deploy is started from the stage, the stage
SHALL ask in a dialog titled "Your last build failed", with "Deploy last
build" and "Cancel", before anything is sent. "Cancel" SHALL stop the deploy
with nothing sent and no failure shown; "Deploy last build" SHALL deploy the
last successful build. The terminal SHALL NOT ask the same question for that
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
{network} is tied to this browser's wallet. Save the keypair so you can
update it from another browser." with "Save keypair" and "Not now". "Save
keypair" SHALL download the wallet's keypair file and hide the line for that
wallet; "Not now" SHALL hide it for that wallet. The choice SHALL be kept per
wallet address in this browser.

#### Scenario: Not now sticks (manual)

- **WHEN** the user presses "Not now" and deploys again with the same wallet
- **THEN** the backup line does not show

### Requirement: History links open each record's network

Each history record SHALL keep the network it was deployed to, the deploy's
transaction signature and its cost. Each row's Explorer link SHALL open the
record's network, whatever network is picked now, and its label SHALL name
that network ("Explorer (devnet)"). Records written without a signature or
cost SHALL still list.

#### Scenario: client-v2-deploy: A devnet record viewed on testnet

- **WHEN** the history holds a devnet record and the picked network is testnet
- **THEN** that row's Explorer link reads "Explorer (devnet)" and its address
  carries `cluster=devnet`

### Requirement: The assistant's approvals ask with the cost

The assistant's approval card for a deploy SHALL be titled "Deploy {program}
to {network}? It costs about {cost} SOL.", where `{cost}` is estimated from
the built program's size; when no estimate is available the second sentence
SHALL be left out. The card for a build SHALL be titled "Build {program}?".
`{program}` is the project's name.

#### Scenario: Deploy approval names the cost (manual)

- **WHEN** the assistant asks to deploy a built program on devnet
- **THEN** the card reads "Deploy {project} to devnet? It costs about
  {cost} SOL." with Allow and Deny

### Requirement: Deploy events

The `features/deploy` slice SHALL emit, with prefix `deploy`:

- `deploy_started` when a deploy starts from the stage, with `cluster` (the
  network's name) and `redeploy` (boolean);
- `deploy_succeeded` when it finishes, with `cluster` and `redeploy`;
- `deploy_failed` when it stops with an error, with `cluster` and `step`
  (`funding`, `buffer`, `write`, `deploy`, `checks`);
- `deploy_sol_needed_shown` when the "Not enough SOL" card shows, with
  `cluster` and `reason` (`signed_out`, `no_faucet`, `airdrop_failed`);
- `deploy_backup_shown`, `deploy_backup_saved` and `deploy_backup_dismissed`
  for the backup line, with no parameters.

No event SHALL carry an address, a program id, a signature or an amount.

#### Scenario: Events of a stage deploy (manual)

- **WHEN** a deploy from the stage succeeds
- **THEN** `deploy_started` and `deploy_succeeded` are sent with the same
  `cluster`
