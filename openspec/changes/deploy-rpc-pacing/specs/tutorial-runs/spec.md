# Spec Delta

## ADDED Requirements

### Requirement: The faucet opens with the wallet filled in

The "Open faucet" link of a tutorial's "Not enough devnet SOL" card SHALL open `https://faucet.solana.com` in a new
tab with the learner's wallet address and the devnet cluster filled in
(`https://faucet.solana.com/?walletAddress=<address>&cluster=devnet`). On the card a deploy posts, the link SHALL also
ask for 5 SOL (`&amount=5`), the most the devnet faucet gives in one request.

#### Scenario: The deploy's faucet link (manual)

- **WHEN** a tutorial deploy's airdrop is refused and the "Not enough devnet SOL" card shows
- **THEN** its "Open faucet" link is `https://faucet.solana.com/?walletAddress=<address>&cluster=devnet&amount=5`
  with the learner's wallet address

#### Scenario: A run's faucet link (manual)

- **WHEN** a tutorial run or call posts the "Not enough devnet SOL" card
- **THEN** its "Open faucet" link is `https://faucet.solana.com/?walletAddress=<address>&cluster=devnet`

### Requirement: The Writing buffer stage counts transactions

While a tutorial deploy writes its buffer, its act card SHALL read "Writing buffer", the stage count, and
"· N of M transactions", where M is the number of write transactions the program needs and N the number written so
far, as each write lands.

#### Scenario: The count rises during the write (manual)

- **WHEN** Hello Anchor's step 2 deploys
- **THEN** the act card reads "Writing buffer" with "· N of M transactions", and N rises to M before "Deploying"

### Requirement: A funded wallet passes the airdrop card on any cluster

The airdrop card's balance check SHALL read the wallet on the selected cluster, whichever it is, so a wallet that
holds the next deploy's cost passes the card as the airdrop act requirement describes. Only an unknown cluster SHALL
skip the check and show the card. The acts after it keep their own cluster rules: a deploy off devnet still refuses.

#### Scenario: A funded wallet on localnet (manual)

- **WHEN** the network is localnet, the wallet holds more than Lumberjack's deploy cost, and the lesson reaches step
  2's airdrop card
- **THEN** the card passes with no press and no airdrop, and the deploy card follows

### Requirement: The deploy line says why its SOL is mostly rent

Right after "Deploying from <wallet> · about <amount> SOL", a tutorial deploy SHALL print a line starting "Note:" that
says most of the amount is rent. On a first deploy it SHALL name the program's size in KB and say that closing the
program returns the rent; on an upgrade it SHALL say that the buffer's rent comes back once the upgrade lands.

#### Scenario: A first deploy explains its rent (manual)

- **WHEN** Lumberjack's step 2 deploys a program of 209,552 bytes for the first time
- **THEN** the terminal reads "Deploying from <wallet> · about 1.09 SOL" followed by "Note: Most of this is rent, a
  deposit that keeps the program's 205 KB on chain; closing the program returns it."
