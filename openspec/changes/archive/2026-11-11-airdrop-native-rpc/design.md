## Context

HOO-2798: the platform RPC answers `requestAirdrop` with a 500. The cluster's own RPC is configured per cluster as
`REACT_APP_<CLUSTER>_READ_BUFFER_RPC_URL`, which `deploy-rpc-pacing` added for buffer reads.

## Goals / Non-Goals

**Goals:** route every Playground airdrop's request and confirmation to the cluster's native RPC; keep the selected
RPC where there is none.

**Non-Goals:** a new env variable; changing `pg.connection` in user scripts; handling the native faucet's own refusal.

## Decisions

- **One URL per cluster, two purposes.** The env value is the cluster's native RPC; the entity names it so
  (`nativeRpcUrl`, `getNativeConnectionFor`). `PgConnection` keeps one name per purpose, `getReadBufferConnection`
  and `getAirdropConnection`, so a guard on buffer reads cannot move airdrops. The variable names stay, since
  deployments set them.
- **A signature is confirmed where it was issued.** `PgTx.confirm` gets the airdrop connection; another RPC may not
  know the signature yet.
- **The `airdrop` command measures on the airdrop's RPC; a deploy's funding check stays on the selected one.** The
  command's before and after reads say what this airdrop added, so they read where it landed. The tutorial's funding
  check decides whether the deploy, which sends on the selected RPC, can pay, so it reads there.
- **The default test file is left alone.** It is user code on `pg.connection`, the selected RPC; it fails on a
  platform RPC that refuses airdrops, as any user script would.

## Risks / Trade-offs

- [The native faucet refuses] On 11 Nov 2026 `api.devnet.solana.com` answered 410 "The RPC faucet is closed on this
  cluster". The terminal shows that answer instead of the platform's 500; pointing people to the web faucet on a 410
  is a follow-up.
- [A lagging selected RPC after a tutorial airdrop] `fundForDeploy` reads the balance three times a slot apart; a
  platform RPC further behind reports "The airdrop did not reach the wallet".
