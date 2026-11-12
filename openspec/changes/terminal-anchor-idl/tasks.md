# Tasks

All tasks land in one PR from `feat/terminal-anchor-1.1.2` ([design.md](design.md), "Migration Plan"), in this order.
Tasks 1.1 and 2.1 may run at the same time. Every task: ticket to file.

## 1. IDL upload from the terminal

- [x] 1.1 Create `client-v2/src/features/program-idl` from the HOO-2486 spike (commit `aaa4be84d`): add
  `@solana-program/program-metadata` 0.11.0 to `client-v2/package.json`; move `uploadIdl`,
  `NotProgramAuthorityError`, `idlMetadataAddress`, and `toStages` to `model/upload.ts`; declare `idl_upload_started`,
  `idl_uploaded`, and `idl_upload_failed` with doc comments in `model/telemetry.ts`; register `"program-idl": "idl"`
  in `shared/lib/telemetry/prefixes.ts`; and export from `index.ts` one entry that runs the checks of "An upload
  refuses without a usable IDL or the upgrade authority", sends the events, and uploads. Verify: unit tests with a
  fake connection and wallet assert, through the memory provider, each `reason` of "A failed upload names its
  reason" and the event order of a successful upload; a test of `toStages` covers a sequential plan that holds a
  parallel one; `src/app/slice-structure.test.ts`, `yarn lint`, and `yarn test-types` pass.
- [ ] 1.2 Rewrite `client-v2/src/commands/anchor/anchor.ts` as a `createCmd` tree: `idl init [PROGRAM_ID]` and
  `idl upgrade [PROGRAM_ID]` call the slice's entry after `checkWallet` and #131's mainnet refusal and network hold;
  the seven other subcommands throw the not-supported line without a wallet check; the command no longer imports
  `anchor-cli`. Verify: `anchor.test.ts` covers the project's program id and a given one, the mainnet refusal with
  nothing sent, an endpoint changed before the upload, the hold released after a failed upload, each unsupported
  name, and `anchor idl --help`; no file under `client-v2/src` calls `runAnchor`. Depends on 1.1 and on #131 being
  in `master`.

## 2. Remove the Anchor 0.29 CLI

- [x] 2.1 Pass `with: build: false` to `reusable-checks.yml` in `.github/workflows/cicd.yml`, pin every `uses:` line
  of `cicd.yml` by commit SHA with the version as a comment, and correct the comment on the `build` input of
  `reusable-checks.yml`, which says `cicd.yml` runs the job. Verify: the workflow parses as YAML, each pinned SHA is
  the commit its tag names, and no caller of `reusable-checks.yml` leaves `build` at its default.
- [ ] 2.2 Delete `wasm/anchor-cli` and every reference [design.md](design.md) lists under "`wasm/anchor-cli` is
  deleted in the same PR, after the command stops loading it", and record in the wasm paragraph of `CLAUDE.md` that
  an upstream sync keeps the folder deleted. Verify: `yarn setup` builds five packages;
  `node scripts/wasm-stubs.mjs check-build build` passes on a `yarn build:bundle` output; `yarn test-api` passes;
  the wasm format and clippy commands of `reusable-checks.yml` pass; no manifest under `wasm/` names `anchor-lang`
  or `anchor-syn`; `yarn bundle:info` is run, `client-v2/bench/BUNDLE.md` is committed, and the PR description
  explains each moved row. Depends on 1.2 and 2.1.
- [ ] 2.3 Update the `wbdi-flow` change with `/opsx:update`: its task 3.1 extends the existing `program-idl` slice;
  its task 3.5 and its requirement "The project's IDL is uploaded on chain" drop the Anchor IDL account as an upload
  target and call the slice's entry; its requirement "IDL telemetry" names this change's event requirements instead
  of describing the upload events again. Verify: `yarn spec:validate` passes, and no requirement name in
  `wbdi-flow`'s `client-v2-program-idl` delta equals one in this change's. Depends on 1.1.

## 3. Integration

- [ ] 3.1 On Devnet, deploy the default Anchor starter through the stable server, build its IDL with the IDL build
  guide, load it with "Upload IDL", and run `anchor idl init`, then `anchor idl upgrade`, once with the Playground
  wallet and once with an external wallet. Then force a failure after the first transaction of an upload. Verify:
  the `program-metadata` command-line client at 0.5.1, the version Anchor 1.1.2 runs, reads back the JSON the
  project holds; Explorer shows the IDL on the program's page; the external wallet asks for one approval; and the PR
  description records whether the forced failure left a buffer account holding rent, with a ticket if it did. This
  is a manual check with a funded wallet, since the Devnet faucet is closed. Depends on 1.2.
- [ ] 3.2 Run `yarn run check` in `client-v2` and `yarn spec:validate`. Verify: both pass. Depends on every task
  above.

## Workflow follow-up

- Ask whether to close the change before opening the PR that ticks 3.2.
