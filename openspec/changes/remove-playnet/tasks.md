# Tasks

All tasks land in one PR (HOO-2903); the groups run in order.

## 1. Playnet leaves the clusters

- [x] 1.1 Remove `playnet` from `clusters.ts` and `Endpoint.PLAYNET` from `endpoint.ts`, with no mapping of a stored Playnet network in `settings/stored-endpoint.ts`; verify `yarn test-unit src/settings/stored-endpoint.ts src/entities/cluster/model/clusters.ts` passes with the Playnet cases removed
- [x] 1.2 Remove the e2e test "playnet is not down while it starts" from `e2e/client-v2-layout.e2e.spec.ts`; verify with `yarn test-e2e e2e/client-v2-layout.e2e.spec.ts` (depends on 1.1)

## 2. No code path reaches Playnet

- [x] 2.1 Delete `src/utils/playnet` and remove `PgPlaynet` from `utils/connection.ts`, `utils/index.ts`, `utils/package.ts`, and `hooks/useConnection.tsx`; verify `yarn test-types` passes (depends on 1.1)
- [x] 2.2 Drop the Playnet branches in `effects/tx`, `widgets/status/model/indicators.ts`, `commands/deploy/bpf-loader-upgradeable.ts`, `commands/airdrop/sign-in-gate.ts`, `features/project-export/model/typescript-profile.ts`, `entities/cluster`, and `"playnet"` in the deploy and fund-wallet telemetry types; verify `yarn test-types`, `yarn lint`, and `yarn test-unit` pass, with the Playnet cases of those modules' tests removed (depends on 2.1)

## 3. The package and its sources leave the build

- [x] 3.1 Remove `@solana-playground/playnet` from `client-v2/package.json` and `yarn.lock`, and `playnet` from the chunk regex in `client-v2/craco.config.js`; verify `yarn install --frozen-lockfile` and `yarn build-fast` pass (depends on 2.1)
- [x] 3.2 Delete `wasm/playnet`, remove `"playnet"` from `exclude` in `wasm/Cargo.toml` and the Playnet mention in `wasm/stub-packages.sh`, and list `wasm/playnet` beside `wasm/anchor-cli` in the root `CLAUDE.md` as a folder an upstream sync keeps deleted; verify `cargo +1.95.0 metadata --manifest-path wasm/Cargo.toml` succeeds
- [x] 3.3 Run `yarn bundle:info` and commit `bench/BUNDLE.md` if a row moved; verify `yarn test-build` passes (depends on 3.1)
- [x] 3.4 Delete `wasm/pkgs/playnet`, and name it beside `wasm/playnet` in the root `CLAUDE.md` note from 3.2; verify `git grep "pkgs/playnet"` finds only `client/package.json` and `client/yarn.lock` (depends on 3.1)

## 4. Docs

- [x] 4.1 Remove Playnet from "Getting SOL" in `docs/assistant-context.md` and run `yarn sync-assistant-context`; verify the synced copy matches

## Workflow follow-up

- After the merge, confirm Dependabot closed alerts 389, 391, 392, and 394 on `wasm/playnet/Cargo.lock`.
- Archive the change on a human's yes, in the PR that ticks the last task.
