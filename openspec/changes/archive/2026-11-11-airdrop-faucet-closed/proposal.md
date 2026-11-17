## Why

Since 3 Nov the public devnet RPC answers `requestAirdrop` with HTTP 410 and
`{"code": 410, "message": "The RPC faucet is closed on this cluster. Request test SOL at https://faucet.solana.com"}`.
After `airdrop-native-rpc` (#507) every Playground airdrop goes to that RPC, so on devnet the terminal prints the raw
JSON, and the automatic airdrop asks the closed faucet again (HOO-2824).

## What Changes

- One helper, `isFaucetClosed` in `shared/lib/faucet`, recognises the closed faucet from the refused airdrop's
  message: the HTTP 410 web3.js reports, or the JSON-RPC error's own words.
- Wherever an airdrop's refusal reaches the user, a closed faucet reads as one line that links the web faucet with
  the wallet's address and the cluster filled in: the terminal's `airdrop` (and the wallet menu's Airdrop, the
  Interact stage's "Get devnet SOL" and the automatic airdrop, which run it) and the deploy's funding card. The
  tutorial's "Not enough devnet SOL" cards say the RPC faucet is closed beside their existing "Open faucet".
- The session remembers, in memory, which airdrop RPC answered closed. The automatic airdrop and a deploy's top-up
  then point to the web faucet without asking that RPC (the editor's deploy: the `deploy` command and the Deploy
  stage); the `airdrop` command still asks, since the faucet may reopen,
  and an airdrop that lands forgets the answer.
- A tutorial's funding logs a closed faucet as a warning, as it logs the faucet's limit, instead of reporting it.
- Telemetry: no event is added, renamed or removed. `fund_airdropped` (funnel-events) keeps firing from the `airdrop`
  command once an airdrop arrives.

## Capabilities

### New Capabilities

### Modified Capabilities

- `client-v2-wallet-funding`: a closed RPC faucet points to the web faucet and is not asked again by the automatic
  airdrop or a deploy's top-up.

## Impact

- `client-v2/src/shared/lib/faucet.ts`, `commands/airdrop` (the command and the session's memory of closed
  faucets), `commands/deploy/deploy.ts`, `effects/automatic-airdrop`, `fundForDeploy` in
  `features/tutorial-conversation`, and the tutorial's result cards in `widgets/tutorial-conversation`.
- A devnet user reads where to get SOL instead of a JSON error, and the automatic airdrop stops spending a request on
  each balance change once the faucet said it is closed.
- Out of scope: a faucet of Playground's own (HOO-2356 lists it as its own ticket); localnet and custom endpoints,
  whose faucets answer as before; a tutorial's funding (its airdrop card and its run and deploy top-ups), which asks
  the faucet each time and does not record a closed answer.
