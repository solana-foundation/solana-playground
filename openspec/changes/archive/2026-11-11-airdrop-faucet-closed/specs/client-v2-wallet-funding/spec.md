## ADDED Requirements

### Requirement: A closed RPC faucet points to the web faucet

When an airdrop's RPC refuses it as closed (HTTP or JSON-RPC 410, "The RPC faucet is closed on this cluster"), the
`airdrop` command SHALL end with one line, in place of the RPC's answer, that links
`https://faucet.solana.com/?walletAddress=<wallet>&cluster=<cluster>`. The wallet menu's Airdrop, the Interact
stage's airdrop and the automatic airdrop SHALL show that line through the command. A deploy's funding card and a
tutorial's "Not enough devnet SOL" card SHALL say the RPC faucet is closed and keep their "Open faucet" link.

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
