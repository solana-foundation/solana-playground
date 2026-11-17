# Spec Delta

## MODIFIED Requirements

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

- **WHEN** the Playground is on mainnet-beta and a paying wallet is connected
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
