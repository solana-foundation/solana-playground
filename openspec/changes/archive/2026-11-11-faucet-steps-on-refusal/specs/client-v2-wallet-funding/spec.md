# Spec Delta

## ADDED Requirements

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
