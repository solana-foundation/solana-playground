## Why

Every Playground airdrop asks the selected RPC for SOL. On devnet that is the platform RPC (Helius), which answers
`requestAirdrop` with `500 internal error: please contact Helius support` (HOO-2798), so the terminal's `airdrop`,
the wallet menu's Airdrop, the automatic airdrop, a deploy's top-up and a tutorial's funding all fail there. The
cluster's own RPC is already configured per cluster for deploys' buffer reads.

## What Changes

- An airdrop requests SOL from the cluster's native RPC, the one `REACT_APP_<CLUSTER>_READ_BUFFER_RPC_URL` sets, and
  confirms the signature on that same RPC. With no such URL (Localnet, Playnet, a custom endpoint on no known
  cluster), it uses the selected RPC as before.
- The `airdrop` command reads the balance before and after the airdrop on that RPC too, so the RPC that confirmed the
  airdrop is the one that reports what arrived.
- A tutorial's funding check reads the balance on the selected RPC, which the deploy spends on; only its airdrop and
  the airdrop's confirmation move.
- The env variables keep their names (they are set in Vercel); their documentation says they serve airdrops too.
- Telemetry: no event is added, renamed or removed. `fund_airdropped` (funnel-events) keeps firing from the `airdrop`
  command once the airdrop arrives.

## Capabilities

### New Capabilities

### Modified Capabilities

- `client-v2-wallet-funding`: airdrops go through the cluster's native RPC.

## Impact

- `client-v2/src/utils/connection.ts` (`PgConnection.getAirdropConnection`), `entities/cluster` (the native RPC
  URL per cluster), `shared/config/client-env.ts`, `.env.example`, `commands/airdrop/airdrop.ts`, and
  `devnetFunding` in `features/tutorial-conversation`.
- A user on devnet sees the native RPC's answer to an airdrop instead of the platform's 500. On 11 Nov 2026
  `api.devnet.solana.com` answered `410 The RPC faucet is closed on this cluster`, so the faucet itself is out of
  this change's reach.
- Out of scope: the default test file's `pg.connection.requestAirdrop`, which is user code on the selected
  connection; the web faucet link shown on a 429; buffer reads, which keep their own requirement in
  `client-v2-deploy`.
