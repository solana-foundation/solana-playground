# Proposal

## Why

A deploy on a platform RPC failed in two ways during the Lumberjack tutorial work (HOO-2362): the RPC refused
buffer writes sent faster than its plan allows, and it did not return a buffer account written seconds before, so
the deploy re-sent chunks that had landed and never finished. The branch fixes both in code; no spec says what a
deploy does about either, so nothing checks the fix and the next edit can undo it.

## What Changes

- Buffer writes are paced: they start at a fixed rate, halve on a rate limit and rise after a run of accepted
  writes, never above the cluster's send cap: 4 writes per second on devnet, testnet and mainnet-beta, unless a
  positive `REACT_APP_DEVNET_SEND_TX_PER_SECOND`, `REACT_APP_TESTNET_SEND_TX_PER_SECOND` or
  `REACT_APP_MAINNET_SEND_TX_PER_SECOND` replaces it. Localnet, Surfpool and Playnet have no cap.
- A load that lands no chunk in `MAX_STALLED_ROUNDS` rounds in a row fails, and the buffer's SOL is returned.
- A deploy the Deploy stage started closes its buffer after a failed write without asking in the terminal; a deploy
  typed in the terminal keeps its question.
- Buffer accounts are read through a per-cluster read-buffer RPC (`REACT_APP_DEVNET_READ_BUFFER_RPC_URL`,
  `REACT_APP_TESTNET_READ_BUFFER_RPC_URL`, `REACT_APP_MAINNET_READ_BUFFER_RPC_URL`); sends and every other read stay
  on the selected RPC. The kept-buffer line names that RPC in its close command, and Settings shows the selected
  cluster's read-buffer RPC under the network chips, with the `solana program show --buffers` and `solana program
  close --buffers` commands that need it, each with a Copy button.
- Stop shows in the console strip while a build runs and is hidden while a deploy runs, until Stop can end a
  tutorial deploy. Ctrl+C in the terminal still stops a deploy.
- The console strip draws a progress bar while a deploy writes its buffer.
- The faucet links of the tutorial's and the docs link's "Not enough devnet SOL" cards, and of the Deploy stage's "Not
  enough SOL" card, open with the wallet's address filled in; the tutorial deploy's card also asks for 5 SOL. The tutorial deploy's "Writing buffer" stage reads
  "· N of M transactions".
- Telemetry: the Settings widget adds `settings_buffer_command_copied` (`command`: `show` or `close`), sent when a
  read-buffer command is copied; no event is renamed or removed. The Deploy funnel step's `deploy_started` and
  `deploy_succeeded` keep firing from `commands/deploy/deploy.ts` and `features/deploy/model/stage-deploy.ts`.

## Capabilities

### New Capabilities

- `client-run`: the "Get devnet SOL" link with the address. `openspec/specs/` has no `client-run` yet: the open change
  `docs-open-link` adds it with the funding requirement this link refines, so the link is added here as a
  requirement of its own, and whichever change archives first creates the spec.

### Modified Capabilities

- `client-v2-deploy`: paced buffer writes, the stalled-round failure, the stage's silent buffer close, the
  read-buffer RPC, and the stage's faucet link with the address.
- `client-v2-command-stop`: Stop only for a build, the read-buffer RPC in the kept-buffer line, and the strip's
  progress bar.
- `tutorial-runs`: the faucet link with the address and 5 SOL, and the "Writing buffer" transaction count. The
  deploy requirement these refine is added by `tutorial-flow-v2`, so they are added here as requirements of their own.

## Impact

- Code: `client-v2/src/commands/deploy/` (`bpf-loader-upgradeable.ts`, `deploy.ts`, `stopped.ts`),
  `client-v2/src/utils/connection.ts`, `client-v2/src/shared/config/client-env.ts`,
  `client-v2/src/shared/lib/rpc-rate-limit/`, `client-v2/src/shared/lib/faucet.ts`,
  `client-v2/src/views/flow/console/`, and the tutorial deploy runner and cards.
- Configuration: six optional `REACT_APP_*` variables, listed in `client-v2/.env.example`. Unset, a deploy reads
  buffers through the selected RPC and paces writes up to 4 per second on devnet, testnet and mainnet-beta.
- Out of scope: which RPC each cluster resolves to and what `localStorage` stores for it, which `cluster-entity`
  owns; a Stop that ends a tutorial deploy and closes leftover buffers from earlier runs; a send cap that
  applies only to the platform URL rather than to the whole cluster; reading the RPC's `Retry-After` and
  `X-Ratelimit-*` headers.
