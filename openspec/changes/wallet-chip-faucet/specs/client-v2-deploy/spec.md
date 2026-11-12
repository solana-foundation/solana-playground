# Spec Delta

## MODIFIED Requirements

### Requirement: The stage funds the wallet only when the user asks

The Playground SHALL NOT request an airdrop the user did not ask for:
`wallet.automaticAirdrop` ("Automatic airdrop" in Settings) SHALL default to
off. When a deploy started from the stage finds the wallet's balance below
what the deploy needs, the run SHALL stop before anything is sent and the
stage SHALL show a "Not enough devnet SOL" card (`role="alert"`,
`aria-label="Not enough SOL"`; the title names the network) with the
balance, the amount needed, the wallet address with copy, a reason and
"Open the web faucet" (opens `https://faucet.solana.com` in a new tab with the
address, 5 SOL and the cluster filled in, devnet and testnet only). The reason and the card's first action SHALL be:

- on a network with a faucet while automatic airdrop is off: "Request devnet
  SOL from the faucet, or send SOL to the wallet below." and "Request
  airdrop", which runs the deploy again and requests the airdrop;
- when a public faucet needs a session and the user is signed out: "Sign in
  with GitHub to request devnet SOL." and "Sign in", after which the deploy
  runs again and requests the airdrop;
- on a network without a faucet: "This network has no faucet. Send SOL to
  the wallet below." and "Try again" (runs the deploy again);
- when the airdrop fails: "The faucet did not send SOL.", the faucet's
  answer, the web faucet in three numbered steps (`aria-label="Get SOL from
  the web faucet"`, the last "Come back here and press Try again", on a
  network the faucet serves), and "Try again" (runs the deploy again and
  requests the airdrop again);

An airdrop the run requests, on that press, or without a question when the
user turned automatic airdrop on, SHALL be the shortfall plus fee headroom,
capped at the network's faucet amount, and the stage SHALL show "Funding
wallet" as the first step. A deploy typed in the terminal SHALL keep its
airdrop question. When an automatic airdrop fails, the terminal's note SHALL
link the web faucet with the address, the airdrop's amount and the cluster
filled in.

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
  the address, the three web faucet steps, "Try again" and "Open the web
  faucet", and the terminal asked nothing;
  pressing "Try again" requests the airdrop again, with automatic airdrop off
