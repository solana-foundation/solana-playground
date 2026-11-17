# Spec Delta

## ADDED Requirements

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

`fund_dialog_opened` SHALL carry `from: "deploy-card"`, `"tutorial-card"` or
`"faucet-toast"` when opened from these, beside the existing
`"account-menu"` and `"wallet-chip"`.

#### Scenario: The Deploy stage's card opens the dialog (manual)

- **WHEN** a deploy stops for too little SOL and the user presses "Send from your wallet" on the "Not enough SOL" card
- **THEN** the Fund dialog opens and `fund_dialog_opened` is emitted once with `from: "deploy-card"`

#### Scenario: The card offers it with no faucet (manual)

- **WHEN** the "Not enough SOL" card shows on a cluster with no faucet
- **THEN** it offers "Send from your wallet" and no web-faucet link

#### Scenario: A tutorial card opens the dialog (manual)

- **WHEN** the tutorial's "Not enough devnet SOL" card of a deploy or of a run shows and the user presses "Send from your wallet"
- **THEN** the Fund dialog opens and `fund_dialog_opened` is emitted once with `from: "tutorial-card"`

#### Scenario: Another wallet was short (manual)

- **WHEN** an extension wallet is current and a card says it is short
- **THEN** the card offers no "Send from your wallet"

#### Scenario: The faucet-refused toast opens the dialog (manual)

- **WHEN** the wallet menu's airdrop hits the faucet's limit and the user presses "Send from your wallet" in the toast
- **THEN** the Fund dialog opens with `from: "faucet-toast"` and stays open after the toast is gone

#### Scenario: No wallet installed (manual)

- **WHEN** no wallet extension is installed and the user presses "Send from your wallet" on any of these
- **THEN** the dialog says "No wallet extension found in this browser."
