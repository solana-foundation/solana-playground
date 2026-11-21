# Tasks

All tasks belong to HOO-2901 and land in one PR into `master`, as #176 did. Group 1 runs first, while the Rust
`solana` still builds. Groups 2 and 4 may run in parallel after it; group 3 needs group 2.

## 1. Record the Rust CLI's output

- [x] 1.1 With the real `solana-cli` package, run on Devnet and save under `client-v2/src/commands/solana/__fixtures__/`
  each command's RPC responses and printed text: `solana confirm -v` on a successful and a failed transaction (a
  version-0 one if Devnet has it), `solana confirm` on an unknown signature, `solana program show --buffers` with no
  buffer and with one, `solana program close --buffers` with no buffer and with one, each case once with `-u d` or a
  URL (HOO-2901). Verify: the fixture folder holds every case, and its README names the commit and cluster they came
  from.

## 2. solana in TypeScript

- [x] 2.1 Rewrite `commands/solana/solana.ts` with `createCmd`/`createSubcmd`/`createOptions` on `@solana/kit`: the
  `confirm` and `program` subcommands, `-u`/`--url` with the cluster names, the wallet check on `program` only, and the
  handler that lists the subcommands (HOO-2901; depends on 1.1). Verify: `commands/solana` unit tests for the `-u`
  resolution, and Playwright tests `client-v2-terminal: An unknown solana subcommand` and
  `client-v2-terminal: solana help` pass.
- [x] 2.2 `solana confirm [-v]`: the status line and the verbose transaction printer (HOO-2901; depends on 2.1). Verify:
  unit tests format each recorded `confirm` response into the recorded text byte for byte, and `run-call.ts`'s
  `PgCommand.solana.execute("confirm", signature, "-v")` prints the details after an Interact call on Devnet.
- [x] 2.3 `solana program show --buffers` and `solana program close --buffers`, printing through
  `utils/terminal/buffers-table.ts`; drop the table detection from `PgTerminal.logWasm` and keep `logWasm` (HOO-2901;
  depends on 2.1). Verify: unit tests match the recorded `show` and `close` cases, and `buffers-table.ts`'s own tests
  still pass.
- [ ] 2.4 Point `commands/deploy/deploy.ts`'s on-chain-data hint at Settings ("Add a custom RPC in Settings, under
  Network, and try again.") (HOO-2901). Verify: `deploy.test.ts` asserts the new line and no `config set` text remains
  in `client-v2/src`.
- [ ] 2.5 Run every scenario of the `client-v2-terminal` delta marked `(manual)` on Devnet, the `stopped.ts` command
  after a deliberately stopped deploy included (HOO-2901; depends on 2.2, 2.3). Verify: the transcript, with dates and
  signatures, is in the PR description.

## 3. Delete spl-token and the Rust crates

- [ ] 3.1 Delete `commands/spl-token` and update `commands/needs-connection.test.ts`; add the Playwright test
  `client-v2-terminal: Typing spl-token` beside `Typing sugar` (HOO-2901; depends on 2.1). Verify: both tests pass.
- [ ] 3.2 Delete `wasm/solana-cli`, `wasm/spl-token-cli`, `wasm/solana-client` and `wasm/utils/` `solana-cli-config`,
  `solana-cli-output`, `solana-clap-v3-utils`, `solana-extra`; update `wasm/Cargo.toml`, `wasm/build.sh`,
  `wasm/stub-packages.sh`, `wasm/README.md`; run `cargo update --workspace` from `wasm/`; drop the two packages from
  `client-v2/package.json`, `yarn.lock`, `utils/package.ts`, `scripts/wasm-stubs.{sh,mjs,test.mjs}` and the
  `scripts/vercel-install.sh` comment (HOO-2901; depends on 2.3, 3.1). Verify: `yarn setup` on the real packages
  passes, `wasm/Cargo.lock` holds no ed25519-dalek 1.x, curve25519-dalek 3.x, borsh below 1.0, rand 0.7 or
  serde_with 2.x, and `node scripts/wasm-stubs.mjs check-build build` passes on a production build.
- [ ] 3.3 Move `e2e/wasm-clis.e2e.spec.ts`'s `solana config get` and `spl-token --help` cases out (the `solana`
  behaviour is covered by 2.1 and 3.1), keeping the `rust-analyzer` case under `@real-wasm` (HOO-2901; depends on
  3.2). Verify: `yarn test-e2e e2e/wasm-clis.e2e.spec.ts e2e/client-v2-terminal.e2e.spec.ts` passes.
- [ ] 3.4 Update `docs/assistant-context.md` (then `yarn sync-assistant-context`), `docs/testing.md`, root
  `CLAUDE.md` ("Four of the five local `wasm/*/pkg` deps"), `client-v2/README.md` and
  `src/effects/connection/Local/steps.md` (HOO-2901; depends on 3.2). Verify:
  `git grep -E "solana-cli|spl-token-cli|solana-client|solana-extra"` finds only git history, archived changes and
  this change.
- [ ] 3.5 Refresh `bench/BUNDLE.md` per `client-v2/CLAUDE.md` "Before a PR" (HOO-2901; depends on 3.2). Verify:
  `yarn test-build` passes and the PR description explains each row that moved.

## 4. Other open changes

- [ ] 4.1 With `/opsx:update wbdi-flow`, make its Mainnet refusal in `specs/client-v2-program-deploy` name `solana
  program close --buffers` instead of `program close <program id>` and `set-upgrade-authority`, and its `-um`
  scenario run `solana -um program close --buffers` (HOO-2901). Verify: `yarn spec:validate` passes and
  `git grep "set-upgrade-authority" openspec/changes/wbdi-flow` finds nothing.

## 5. Integration

- [ ] 5.1 Run `yarn run check` and the e2e specs touched in 2.1, 3.1 and 3.3 on the branch head (HOO-2901; depends on
  every task above). Verify: all pass, and the result is in the PR description.

## Workflow follow-up

- After the merge, confirm on GitHub that Dependabot alerts 379, 381, 382, 386 and 388 closed.
- Archive the change when a human says yes, before the PR is opened if this PR ticks the last task.
