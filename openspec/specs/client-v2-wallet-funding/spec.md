# client-v2-wallet-funding Specification

## Purpose

Lets a user move SOL from their own connected wallet into the Playground
wallet, so a deploy can be paid without an airdrop while the Playground wallet
stays the one that deploys.

## Requirements

### Requirement: The account menu offers funding

The account menu SHALL show the item "Fund from a wallet…" whenever a
Playground wallet account exists, and picking it SHALL open the Fund dialog.
The item SHALL be hidden before the Playground wallet has been set up.

#### Scenario: Playground wallet set up

- **WHEN** the user has a Playground wallet and opens the account menu
- **THEN** the menu shows "Fund from a wallet…" in its wallet group

#### Scenario: No Playground wallet yet

- **WHEN** the Playground wallet has not been set up and the user opens the account menu
- **THEN** the menu does not show "Fund from a wallet…"

### Requirement: The Fund dialog sends to the deploying wallet

The dialog, titled "Fund your Playground wallet", SHALL name the receiving
account (its name and short address): the current wallet when it is a
Playground wallet, otherwise the first Playground account, which is the one
`deploy` pays from. Sending SHALL NOT change the current wallet. The short
address SHALL link, with a trailing external-link mark, to that address in
the user's block explorer on the Playground's cluster, opening in a new tab; when the explorer cannot open
that cluster, the address SHALL show without a link.

#### Scenario: Playground wallet is current (manual)

- **WHEN** "Wallet 2" is the current wallet and the user opens the dialog
- **THEN** the dialog names "Wallet 2" and its short address as the receiver

#### Scenario: An extension is current (manual)

- **WHEN** Phantom is the current wallet and the user opens the dialog
- **THEN** the dialog names the first Playground account as the receiver

#### Scenario: The address opens in the explorer

- **WHEN** the Playground is on devnet and the user opens the dialog
- **THEN** the receiver's short address is a link to that address in the block explorer on devnet, opening in a new tab

#### Scenario: A cluster the explorer cannot open (manual)

- **WHEN** the Playground is on a local validator and the chosen block explorer is Solscan, which has no page for it
- **THEN** the receiver's short address shows as plain text

### Requirement: The user picks and connects the paying wallet in the dialog

The dialog SHALL list every detected wallet, each as a button labelled
`Connect <wallet name>` with the wallet's icon, and show the connected one as
a badge with its icon and name, followed by its short address and SOL
balance; the short address SHALL link to the explorer as the receiver's
does. With no wallet detected it SHALL say "No wallet extension found in this
browser." and suggest installing one; while a wallet is asked to connect, its
button SHALL read `Waiting for <wallet name>…`. A wallet connected here SHALL
NOT become the current wallet.

#### Scenario: Connect in the dialog (manual)

- **WHEN** the user presses `Connect Phantom` and approves in Phantom
- **THEN** the dialog shows a Phantom badge, Phantom's short address and balance, and the current wallet is unchanged

#### Scenario: No wallet installed

- **WHEN** no Wallet Standard wallet is detected
- **THEN** the dialog shows "No wallet extension found in this browser." and no amount field

#### Scenario: The user declines the connection

- **WHEN** the user rejects the connection request in the wallet
- **THEN** the dialog stays open, lists the wallets again and says "You declined in Phantom. Nothing was sent."

### Requirement: The amount is checked before the wallet is asked

The amount field (label "Amount (SOL)", id `fund-amount`) SHALL start at 0
and accept a positive number of SOL with at most 9 decimals. The arrow keys
and the field's − and + buttons SHALL step the amount by 0.1 SOL, to the next
multiple of 0.1 in that direction and never below 0. The send button,
labelled `Send <amount> SOL`, SHALL be disabled while the amount is not valid
or exceeds the paying wallet's balance less 0.001 SOL for fees, and while that
balance is unknown. At 0 the field SHALL ask for an amount above 0 as a hint,
not an error. A valid amount SHALL be noted as `Arrives in <receiver name> on
<network>.`, naming the Playground's cluster, and the balance SHALL be read
again when that cluster changes.

#### Scenario: The field starts at 0

- **WHEN** the user connects a paying wallet
- **THEN** the amount reads `0`, the send button is disabled and the field says "Enter an amount above 0." without an error

#### Scenario: Stepping by 0.1

- **WHEN** the amount reads `0` and the user presses + and then the up arrow
- **THEN** the amount reads `0.2`, and from `1.999` the up arrow gives `2` and the down arrow `1.9`

#### Scenario: Amount above the balance

- **WHEN** the paying wallet holds 0.5 SOL and the user enters 1
- **THEN** the send button is disabled and the field says the wallet holds 0.5 SOL

#### Scenario: Not a number (manual)

- **WHEN** the user enters `abc` or `-1`
- **THEN** the send button is disabled and the field asks for an amount above 0

#### Scenario: Where the SOL goes

- **WHEN** the Playground is on devnet and the amount is valid
- **THEN** the field says `Arrives in Wallet 1 on devnet.`

#### Scenario: Mainnet (manual)

- **WHEN** the Playground is on mainnet and a paying wallet is connected
- **THEN** a warning Callout titled "Mainnet uses real SOL" shows above the send button

### Requirement: Sending is one transfer approved in the wallet

The send button SHALL be the dialog's call to action, drawn as the brand
button, with Cancel as a ghost button before it; on a phone Cancel SHALL be
left out and the send button SHALL span the foot in the flat accent. Pressing send SHALL build
one System Program transfer of the amount from the paying wallet to the
receiving account on the cluster the Playground is connected to, ask the
paying wallet to sign it, send it, and wait for confirmation, the button
showing a spinner and staying disabled meanwhile. On success the dialog SHALL
close and a toast SHALL say `Sent <amount> SOL to <receiver name>.`; the
Playground wallet's balance updates on its own.

#### Scenario: Successful funding

- **WHEN** the user sends 1 SOL from Phantom and approves
- **THEN** the receiving account's balance rises by 1 SOL, the dialog closes and the toast says `Sent 1 SOL to Wallet 1.`

#### Scenario: The user declines the transfer

- **WHEN** the user rejects the signature request in the wallet
- **THEN** nothing is sent, the dialog stays open with the amount kept, and it says "You declined in <wallet name>. Nothing was sent."

#### Scenario: The transfer fails on the network (manual)

- **WHEN** the transaction never reaches the cluster, or the cluster runs it and it fails
- **THEN** the dialog stays open, shows "Could not send." with the reason, and the send button can be pressed again

#### Scenario: The transfer is sent but not confirmed (manual)

- **WHEN** the transaction was sent and its confirmation times out or fails
- **THEN** the dialog shows "Sent, not confirmed yet." with the signature and "Check it in Explorer before you send again.", and the send button stays disabled so the SOL cannot be sent twice

### Requirement: Funding is measured

The `features/fund-wallet` slice SHALL emit, with prefix `fund`:
`fund_dialog_opened` `{ via: "account-menu" | "wallet-chip" | "deploy-card" | "tutorial-card" | "faucet-toast" }` (the control that opened it) when the dialog opens;
`fund_wallet_connected` `{ wallet: string, as: "payer" | "current" }` (the wallet's name; `payer` when it
connects in the dialog, `current` when the wallet chip makes it the current wallet);
`fund_wallet_connect_started` `{ wallet: string }` when the wallet chip asks a wallet to connect;
`fund_wallet_connect_failed` `{ wallet: string, reason: "rejected" | "network" | "unconfirmed" | "unknown" }`
when that connect does not happen (`rejected` is the user's no); `fund_wallet_disconnected` `{ wallet: string }`
when the chip disconnects the current wallet; `fund_sent` `{ cluster: "mainnet" | "devnet" | "testnet" | "localnet" | "playnet" }` (the Playground's cluster) when a
transfer is confirmed; and
`fund_failed` `{ stage: "connect" | "send", reason: "rejected" | "network" | "unconfirmed" | "unknown" }` when connecting or sending fails. `session_account_item_picked`
SHALL carry `item: "fund-wallet"` when the menu item is picked. No event
carries an address or an amount.

#### Scenario: A confirmed transfer is counted (manual)

- **WHEN** a transfer is confirmed on devnet
- **THEN** `fund_sent` is emitted once with `cluster: "devnet"`

#### Scenario: A transfer on Mainnet is counted as mainnet (manual)

- **WHEN** a transfer is confirmed on Mainnet
- **THEN** `fund_sent` is emitted once with `cluster: "mainnet"`, not `"mainnet-beta"`

#### Scenario: A declined signature is counted (manual)

- **WHEN** the user rejects the transfer in the wallet
- **THEN** `fund_failed` is emitted once with `stage: "send"` and `reason: "rejected"`

### Requirement: Max fills the sendable balance
The amount field SHALL carry a `Max` button at its end. Pressing it SHALL set
the amount to the paying wallet's balance less 0.001 SOL for fees, written
with at most 9 decimals, so the send button is enabled on it. `Max` SHALL be
disabled while the balance is unknown or unreadable, and when the balance is
0.001 SOL or less.

#### Scenario: Max then send
- **WHEN** the paying wallet holds 2 SOL and the user presses Max
- **THEN** the amount reads `1.999`, and pressing `Send 1.999 SOL` transfers 1.999 SOL

#### Scenario: Balance below the fee
- **WHEN** the paying wallet holds 0.0005 SOL
- **THEN** the Max button is disabled

#### Scenario: Balance loading (manual)
- **WHEN** the paying wallet's balance is still being read
- **THEN** the Max button is disabled

### Requirement: Funding is offered where SOL runs short

Each place that says the deploying wallet holds too little SOL SHALL offer a
button "Send from your wallet" that opens the Fund dialog:

- the Deploy stage's "Not enough SOL" card (`aria-label="Not enough SOL"`),
  for every reason it shows, after its first action and the web-faucet link;
- the tutorial's "Not enough devnet SOL" cards, for a deploy and for a run or
  call, after "Open the web faucet";
- the wallet menu's "The faucet is at its limit." toast, under its
  web-faucet link.

All of them SHALL open one dialog, so a send still pending from an earlier
opening holds Send off whichever entry opens it next, and closing the toast
SHALL NOT close a dialog it opened. With no wallet extension installed the
dialog SHALL say "No wallet extension found in this browser." rather than
show an empty list. An entry SHALL offer the button only when the wallet it
found short is the one the dialog funds (the current Playground wallet, or
the first account when an extension is current); otherwise it leaves the
button out. A request while the dialog is open SHALL change nothing.

`fund_dialog_opened` SHALL carry `via: "deploy-card"`, `"tutorial-card"` or
`"faucet-toast"` when opened from these, beside the existing
`"account-menu"` and `"wallet-chip"`.

#### Scenario: The Deploy stage's card opens the dialog (manual)

- **WHEN** a deploy stops for too little SOL and the user presses "Send from your wallet" on the "Not enough SOL" card
- **THEN** the Fund dialog opens and `fund_dialog_opened` is emitted once with `via: "deploy-card"`

#### Scenario: The card offers it with no faucet (manual)

- **WHEN** the "Not enough SOL" card shows on a cluster with no faucet
- **THEN** it offers "Send from your wallet" and no web-faucet link

#### Scenario: A tutorial card opens the dialog (manual)

- **WHEN** the tutorial's "Not enough devnet SOL" card of a deploy or of a run shows and the user presses "Send from your wallet"
- **THEN** the Fund dialog opens and `fund_dialog_opened` is emitted once with `via: "tutorial-card"`

#### Scenario: Another wallet was short (manual)

- **WHEN** an extension wallet is current and a card says it is short
- **THEN** the card offers no "Send from your wallet"

#### Scenario: The faucet-refused toast opens the dialog (manual)

- **WHEN** the wallet menu's airdrop hits the faucet's limit and the user presses "Send from your wallet" in the toast
- **THEN** the Fund dialog opens with `via: "faucet-toast"` and stays open after the toast is gone

#### Scenario: No wallet installed (manual)

- **WHEN** no wallet extension is installed and the user presses "Send from your wallet" on any of these
- **THEN** the dialog says "No wallet extension found in this browser."

### Requirement: Every refused airdrop shows the way to the web faucet

On a cluster the web faucet serves (devnet, testnet), an airdrop that started
and brought no SOL (a balance read or the request threw, its transaction
failed, or the balance never moved) SHALL be a refusal, whatever the cause; a
failure before the airdrop starts (no wallet, a sign-in, a cluster with no
faucet, a network not read yet) SHALL NOT, and neither SHALL a local
validator's failure, which keeps its own error. Every
refusal SHALL name its cause in one line, "the faucet is at its limit" for a
429 or the faucet's limit words and "the faucet did not send SOL" for any
other, then give the web faucet's three steps (`webFaucetSteps`) and a link
to it filled in with the wallet's address, the cluster and an amount the
faucet's form offers:

- the terminal's `airdrop` prints the cause line, the numbered steps and the
  link, then fails as before;
- the wallet chip's popover shows its refused state (`aria-label="Get SOL from the web faucet"`) with the cause as its headline, and no toast;
- the wallet menu's Airdrop shows `FaucetRefusedToast` with the cause as its
  headline;
- the tutorial's run/call and deploy "Not enough devnet SOL" cards say the
  cause from the airdrop's message: "The devnet faucet is at its limit." or
  "The faucet did not send SOL.";
- the deploy's "Not enough SOL" card shows the steps for `airdrop_failed`.

#### Scenario: A rate-limited airdrop in the terminal (manual)

- **WHEN** `airdrop` runs on devnet and the RPC answers "429 Too Many Requests"
- **THEN** the terminal prints "Airdrop refused: the devnet faucet is at its limit for now.", the three steps and a `https://faucet.solana.com/?walletAddress=…&amount=…&cluster=devnet` link, then the error

#### Scenario: Any other refusal in the terminal (manual)

- **WHEN** `airdrop` runs on devnet and the request fails with "fetch failed"
- **THEN** the terminal prints "Airdrop refused: the devnet faucet did not send SOL.", the same steps and link, then the error

#### Scenario: A local validator's failure keeps its own error (manual)
- **WHEN** `airdrop` runs on localnet and the request fails with "fetch failed"
- **THEN** the terminal prints no faucet note and the error is not a refusal

#### Scenario: A sign-in failure is not a refusal (manual)

- **WHEN** the wallet chip's Get SOL fails because the GitHub sign-in was cancelled
- **THEN** the popover does not show the faucet steps

#### Scenario: The chip after a refusal that is not the limit (manual)

- **WHEN** the chip's Get SOL fails with any error from the faucet's request
- **THEN** the popover shows "The faucet did not send SOL", the three steps and "Open the web faucet", and no toast appears

### Requirement: The assistant knows how to get SOL

`docs/assistant-context.md` SHALL have a "Getting SOL" section, synced into
the assistant's bundled context by `yarn sync-assistant-context`, that says:
the `airdrop` command and the wallet's Get SOL ask the devnet faucet; when it
refuses, the web faucet at `https://faucet.solana.com/?walletAddress=<address>&amount=<0.5|1|2.5|5>&cluster=devnet`
in three steps; the web faucet asks for a GitHub account with a public repo,
and forking solana-playground gives one; "Fund from a wallet" sends SOL from
a browser wallet. It SHALL say the assistant explains these and cannot
airdrop itself.

#### Scenario: Asked for devnet SOL (manual)

- **WHEN** a user asks the assistant "how do I get devnet SOL?"
- **THEN** its context holds the faucet steps and the link shape to answer from, and the synced copy matches `docs/assistant-context.md`

### Requirement: The wallet chip connects an extension wallet

The wallet chip's popover SHALL offer "Connect a wallet" (also the list's heading) while the Playground wallet is current. Pressing
it SHALL list the installed Wallet Standard wallets, each with its icon and name; with none installed it
SHALL say "No wallet extension found in this browser. Install Phantom, Backpack or Solflare, then reload.
Or keep using the Playground wallet.", the same line as the Fund dialog. (The chip is hidden on a phone, so the phone line of
the designers' wallet spec does not apply here.) Choosing
one SHALL show "Waiting for {wallet}…" until the extension answers. An approval SHALL make the extension
the current wallet, as `connect {wallet}` does in the terminal; a decline SHALL say "{wallet} didn't
connect. The Playground wallet is in use." with "Try again"; any other failure SHALL say "{wallet} didn't
connect: {reason}. The Playground wallet is in use." and be reported to the logs. The waiting state SHALL NOT trap: closing the
popover leaves it, reopening while the request is pending shows "Waiting for {wallet}…" again, and a late
approval or decline lands as above.

While an extension is current, the popover's first block SHALL name the extension with its icon in place
of "Playground wallet", show its balance and address, and offer "Disconnect {wallet}", which SHALL make
the Playground wallet current again, and SHALL be disabled with "Disconnect after the deploy finishes" while
a deploy runs. "Send from your wallet" SHALL NOT show then, since the current wallet
is the user's own.

#### Scenario: Connect Phantom from the chip (manual)

- **WHEN** the Playground wallet is current and the user picks Phantom under "Connect a wallet" and
  approves in the extension
- **THEN** the chip shows Phantom's address and balance, and the popover names Phantom and offers
  "Disconnect Phantom"

#### Scenario: No extension installed (manual)

- **WHEN** no Wallet Standard wallet is installed and the user presses "Connect a wallet"
- **THEN** the popover says "No wallet extension found in this browser. Install Phantom, Backpack or
  Solflare, then reload. Or keep using the Playground wallet."

#### Scenario: Disconnect (manual)

- **WHEN** Phantom is current and the user presses "Disconnect Phantom"
- **THEN** the Playground wallet is current again and the chip shows its address

### Requirement: Airdrops go through the cluster's native RPC

Every Playground airdrop (the `airdrop` command, the wallet menu's Airdrop, the automatic airdrop, a deploy's top-up
and a tutorial's funding) SHALL request SOL from the cluster's native RPC, the URL
`REACT_APP_DEVNET_READ_BUFFER_RPC_URL`, `REACT_APP_TESTNET_READ_BUFFER_RPC_URL` or
`REACT_APP_MAINNET_READ_BUFFER_RPC_URL` sets, and SHALL confirm the airdrop's signature on that same RPC. An unset or
empty value, or an endpoint on no cluster the env configures, SHALL use the selected RPC.

#### Scenario: Devnet with a platform RPC (manual)

- **WHEN** devnet is selected through a platform RPC, `REACT_APP_DEVNET_READ_BUFFER_RPC_URL` is
  `https://api.devnet.solana.com`, and the person runs `airdrop 1` or picks Airdrop in the wallet menu
- **THEN** the `requestAirdrop` request goes to `api.devnet.solana.com`, not to the platform RPC

#### Scenario: Localnet (manual)

- **WHEN** Localnet is selected and the person runs `airdrop 1`
- **THEN** the `requestAirdrop` request goes to the local validator

### Requirement: An airdrop's balance is read where the airdrop is measured

The `airdrop` command SHALL read the wallet's balance before and after the airdrop on the RPC that took the airdrop,
and SHALL report what arrived from those two reads. A tutorial's funding check, which decides whether a deploy is
funded, SHALL read the balance on the selected RPC.

#### Scenario: The terminal reports what arrived (manual)

- **WHEN** `airdrop 1` lands on devnet through the native RPC while the platform RPC lags a slot behind
- **THEN** the terminal prints the amount received, read from the native RPC

### Requirement: A closed RPC faucet points to the web faucet

When an airdrop's RPC refuses it as closed (HTTP or JSON-RPC 410, "The RPC faucet is closed on this cluster"), the
`airdrop` command SHALL end with one line, in place of the RPC's answer, that links
`https://faucet.solana.com/?walletAddress=<wallet>&cluster=<cluster>`. The wallet menu's Airdrop, the Interact
stage's airdrop and the automatic airdrop SHALL show that line through the command. A deploy's funding card and a
tutorial's "Not enough devnet SOL" card SHALL say "The devnet RPC faucet is closed.", then show the web faucet's steps with "Open the web faucet". A closed RPC faucet is a refusal as every other: the terminal prints the one
line and no steps, and the wallet chip and the wallet menu show the way to the web faucet without reporting it as a failure.

#### Scenario: `airdrop 1` on devnet while the faucet is closed (manual)

- **WHEN** devnet's RPC faucet is closed and the person runs `airdrop 1`
- **THEN** the terminal prints "Airdropping 1 SOL..." and then
  "The devnet RPC faucet is closed. Request test SOL at https://faucet.solana.com/?walletAddress=<wallet>&cluster=devnet",
  and no JSON

#### Scenario: A tutorial airdrop on a closed faucet (manual)

- **WHEN** a tutorial's airdrop card is pressed and devnet's RPC faucet is closed
- **THEN** the "Not enough devnet SOL" card says the devnet RPC faucet is closed and links the web faucet

### Requirement: A closed RPC faucet is not asked again unasked

After the `airdrop` command finds an airdrop RPC closed, the automatic airdrop and the editor's deploy top-up (the
`deploy` command and the Deploy stage) SHALL NOT request an airdrop from that RPC again in the same session: the
automatic airdrop SHALL print the faucet line once, and a deploy SHALL stop at its funding card, or end a typed
deploy, with that line. The `airdrop` command SHALL still request one, and an airdrop that lands SHALL clear the
answer. The answer SHALL live in memory only, and an RPC that never answered closed (localnet, a custom endpoint that
airdrops through itself) SHALL be asked as before. A tutorial's funding SHALL ask the faucet each time.

#### Scenario: The automatic airdrop after a closed answer (manual)

- **WHEN** `airdrop 1` found devnet's RPC faucet closed and the wallet's balance then changes below the airdrop amount
- **THEN** the terminal prints the faucet line once, and no `requestAirdrop` request is sent

#### Scenario: The command asks again (manual)

- **WHEN** `airdrop 1` found devnet's RPC faucet closed and the person runs `airdrop 1` again
- **THEN** a `requestAirdrop` request is sent
