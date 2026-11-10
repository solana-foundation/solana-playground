# Design

## Context

See [proposal.md](proposal.md), "Why". All three deploy paths (the `deploy` terminal command, the Deploy stage
through `PgDeployRun`, and the tutorial's `realDeployPort`) write the buffer through
`BpfLoaderUpgradeable.loadBuffer` in `client-v2/src/commands/deploy/bpf-loader-upgradeable.ts`, so pacing and the
stalled-round limit live there once. web3.js retries a 429 on its own, which hid every rate limit from the caller.

## Goals / Non-Goals

**Goals:**

- One pace for every deploy path, adjusted from what the RPC answers.
- A deploy that cannot make progress ends with its buffer's SOL back in the wallet.
- Buffer reads that see a write landed seconds before, on any RPC a person selects.

**Non-Goals:**

- Reading `Retry-After` or `X-Ratelimit-*` headers: the 10-second wait matches what the public devnet RPC sends.
- A Stop button that ends a deploy; Ctrl+C keeps that role until Stop can end a tutorial deploy too.

## Decisions

- **Adaptive pace over a fixed rate.** The pace halves on a rate limit and rises by one write per second after 10
  accepted writes in a row. A fixed rate either wastes a fast RPC or keeps hitting a slow one. The write connection
  disables web3.js's own 429 retry, so the first rate limit reaches the pace.
- **The send cap is keyed by cluster, not by URL.** `PgConnection.getSendTxPerSecond` reads
  `REACT_APP_<CLUSTER>_SEND_TX_PER_SECOND` for the connection's cluster. Keying by the platform URL alone would let a
  custom RPC of the same provider exceed the plan's limit. The cost: a person's own faster RPC on that cluster is
  capped too. The variable's value is meant to sit just below the plan's limit, as `client-v2/.env.example` says.
- **Devnet, testnet and mainnet-beta default to a cap of 4.** `DEFAULT_SEND_TX_PER_SECOND` in
  `client-v2/src/entities/cluster/model/clusters.ts` applies when the variable is unset or not a positive number, so
  a deployment that sets no variable stays below the
  [Helius Developer `sendTransaction` limit](https://www.helius.dev/docs/billing/rate-limits). Only a positive value
  overrides it, and no value removes the cap, so a missing or mistyped variable cannot send a platform RPC writes
  faster than its plan allows. Localnet, Surfpool and Playnet keep no cap, since they run on the person's own machine
  or in the browser.
- **The cluster of a custom RPC comes from its genesis hash.** `getClusterOf` in `client-v2/src/utils/connection.ts`
  takes a known endpoint's cluster without a request, and the selected custom endpoint's from `PgConnection.cluster`
  once it is resolved, so the cap and the read-buffer RPC follow a custom devnet RPC as they follow the platform one.
- **Buffer reads go through a second RPC; sends do not.** The platform RPC does not return a buffer written seconds
  before, which made every round re-send landed chunks. Only buffer reads move: the balance, rent and program reads
  stay on the selected RPC, so a person's choice of RPC still decides where the deploy happens.
- **A stalled load ends after `MAX_STALLED_ROUNDS` rounds.** A round that leaves no fewer chunks missing than the
  round before counts as stalled. Without the limit, a refusing RPC keeps a deploy retrying with its buffer funded
  until a reload.
- **The stage closes the buffer without asking.** The Deploy stage asks its questions in the panel, and the terminal
  question had no stop listener, so a stage deploy waited on a prompt nobody saw. Closing is the answer a person
  gives almost every time.
- **The close command names the read-buffer RPC, quoted.** `solana program close --buffers` on the selected RPC may
  list no fresh buffer, for the reason buffer reads moved. The URL is single-quoted because a query string such as
  `?api-key=` makes zsh fail with "no matches found".

## Risks / Trade-offs

- [The read-buffer RPC is down or wrong] → the deploy waits on its buffer read. A task in [tasks.md](tasks.md)
  bounds the read and makes its error name the read-buffer RPC.
- [The cap also limits a person's own fast RPC] → accepted; a per-URL cap is out of scope (proposal, "Impact").
- [Any fetch `TypeError` slows the pace as a rate limit] → the browser hides a 429 without CORS headers behind one,
  so the pace cannot tell them apart; a non-429 failure only costs speed.
