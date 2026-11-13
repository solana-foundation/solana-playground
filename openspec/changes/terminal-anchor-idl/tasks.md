# Tasks

All tasks land in one PR from `feat/terminal-anchor-1.1.2` ([design.md](design.md), "Migration Plan"), in the order
1, 2, 4, 3. Tasks 1.1 and 2.1 may run at the same time, and so may 4.2 and 4.3. Every task: ticket to file.

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
- [x] 1.2 Rewrite `client-v2/src/commands/anchor/anchor.ts` as a `createCmd` tree: `idl init [PROGRAM_ID]` and
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
- [x] 2.2 Delete `wasm/anchor-cli` and every reference [design.md](design.md) lists under "`wasm/anchor-cli` is
  deleted in the same PR, after the command stops loading it", and record in the wasm paragraph of `CLAUDE.md` that
  an upstream sync keeps the folder deleted. Verify: `yarn setup` builds five packages;
  `node scripts/wasm-stubs.mjs check-build build` passes on a `yarn build:bundle` output; `yarn test-api` passes;
  the wasm format and clippy commands of `reusable-checks.yml` pass; no manifest under `wasm/` names `anchor-lang`
  or `anchor-syn`; `yarn bundle:info` is run, `client-v2/bench/BUNDLE.md` is committed, and the PR description
  explains each moved row. Depends on 1.2 and 2.1.
- [x] 2.3 Update the `wbdi-flow` change with `/opsx:update`: its task 3.1 extends the existing `program-idl` slice;
  its task 3.5 and its requirement "The project's IDL is uploaded on chain" drop the Anchor IDL account as an upload
  target and call the slice's entry; its requirement "IDL telemetry" names this change's event requirements instead
  of describing the upload events again. Verify: `yarn spec:validate` passes, and no requirement name in
  `wbdi-flow`'s `client-v2-program-idl` delta equals one in this change's. Depends on 1.1.
- [ ] 2.4 Move the `wasm/` workspace to Rust 1.95.0 ([design.md](design.md), "The `wasm/` workspace builds on Rust
  1.95.0, the server's toolchain"). Verify: the format and clippy commands of `reusable-checks.yml` pass, and the
  `@real-wasm` specs of `client-v2/e2e/wasm-clis.e2e.spec.ts` pass in the PR's CI on packages built with 1.95.0.

## 3. Integration

- [ ] 3.1 On Devnet, deploy the default Anchor starter through the stable server, build its IDL with the IDL build
  guide, load it with "Upload IDL", and run `anchor idl init`, then `anchor idl upgrade`, once with the Playground
  wallet and once with an external wallet. Then run `anchor idl fetch`, the buffer flow (`create-buffer`, then
  `write-buffer --close-buffer`), and `anchor idl close`. Then force a failure after the first transaction of an
  upload. Verify: the Anchor 1.1.2 binary's `anchor idl fetch` prints the JSON the project holds after each write,
  and the terminal's `fetch` prints an IDL that binary's `anchor idl init` wrote; Explorer shows the IDL on the
  program's page; the external wallet asks for one approval; `close` returns the rent; and the PR description
  records whether the forced failure left a buffer account holding rent, with a ticket if it did. This is a manual
  check with a funded wallet, since the Devnet faucet is closed. Depends on 4.4.
- [ ] 3.2 Run `yarn run check` in `client-v2` and `yarn spec:validate`, and refresh `client-v2/bench/BUNDLE.md` as
  task 2.2 did. Verify: both pass, `yarn test-build` passes, and the PR description explains each moved row. Depends
  on every task above.

## 4. The `anchor idl` surface of Anchor 1.1.2

- [x] 4.1 In `client-v2/src/features/program-idl`, extract the path that plans, asks the wallet once, and sends
  stage by stage from `uploadIdl` into one function that takes an instruction plan
  ([design.md](design.md), "One send path for every subcommand that sends"), and give it `--priority-fee`. Add the
  non-canonical account to the upload, without the upgrade-authority check. Verify: the existing upload tests pass
  unchanged in meaning; a test covers a non-canonical upload by a wallet that is not the authority, and one covers
  the priority fee in every transaction of an upload.
- [x] 4.2 Add `fetch`, `close`, `create-buffer`, `set-buffer-authority`, and `write-buffer` to the slice, each with
  the refusals of its requirement, and declare `idl_command_started`, `idl_command_succeeded`, and
  `idl_command_failed` with doc comments in `model/telemetry.ts`. `fetch` moves `fetchProgramMetadataIdl` from the
  HOO-2486 spike. Verify: unit tests with a fake connection and wallet assert, through the memory provider, the
  event order of each subcommand and each `reason` of "A failed subcommand names its reason". Depends on 4.1.
- [x] 4.3 Port `convert` (both directions) and `type` to `client-v2/src/entities/idl` from `convert_idl`,
  `convert_idl_to_legacy`, and `idl_ts` of Anchor at tag `v1.1.2`. Verify: tests compare the output with fixtures
  the Anchor 1.1.2 binary printed for a legacy IDL, a current IDL, and one with `--program-id`; the fixtures and the
  command that made them are committed. Superseded by 4.8.
- [x] 4.4 Rewrite the `idl` subcommands of `client-v2/src/commands/anchor/anchor.ts` as
  [design.md](design.md), "The surface is Anchor 1.1.2's", describes: the eleven subcommands with Anchor's argument
  and option names and success lines, file arguments on project files, `--filepath` optional, the program id rule,
  the localnet skip, the mainnet refusal and network hold on the six that send, the not-supported line for `build`
  and `fetch-historical`, and no subcommand for the four names Anchor removed. First check the facts
  [design.md](design.md) lists under "Facts read, not tested" against the sources, and correct the spec where one
  is wrong. Verify: `anchor.test.ts` covers every requirement of `client-v2-program-idl` that names a terminal line,
  the refusal of `--provider.cluster`, and the unknown-subcommand error of a removed name. Depends on 4.2 and 4.3.
- [x] 4.5 Update the `wbdi-flow` change with `/opsx:update`: its task 3.2 reads the Program Metadata account through
  the slice's `fetch`, and its deploy delta names the requirement "Anchor IDL writes to mainnet are refused" of
  `mainnet-deploy-warning` for the `anchor idl` refusal, with no list of subcommands of its own. Its deploy delta also
  drops "The mainnet guard sends the user to their own machine", "Mainnet guard telemetry", and the events
  `deploy_mainnet_warned` and `deploy_scripts_exported`, and its tasks 2.3 and 2.4 drop the guard dialog: the
  requirements "Deploys to mainnet are refused" and "The Deploy stage points mainnet to the user's machine" of
  `mainnet-deploy-warning` (#131) refuse a mainnet deploy and point it to the user's machine instead. Verify:
  `yarn spec:validate` passes. Depends on 4.2.
- [x] 4.6 Implement "An unfinished upload is finished or closed, never read as an IDL": `init` and `upgrade` finish
  an upload over a buffer left at the canonical address, `fetch` and the upload check the account's discriminator
  before reading it as metadata, `close` closes such a buffer, and a failed upload prints the rent it leaves.
  Verify: in `client-v2/src/commands/anchor/anchor.integration.test.ts`, on LiteSVM, the two `it.fails` cases pass as
  plain cases, the rent case asserts the new line, and a case closes a leftover buffer. Depends on 4.4.
- [x] 4.7 Add `anchor legacy-idl` with `fetch` and `close`, as the `legacy-idl` requirements of
  `client-v2-program-idl` describe, the account address, address resolution, IDL instruction, and lines read from
  Anchor at tag `v1.1.2`; `close` goes through the send path of 4.1 and the mainnet refusal; the events are
  `idl_command_*`. Verify: `anchor.test.ts` covers help and an unsupported name; the integration test on LiteSVM
  fetches by program id and by account address, closes an Anchor IDL account of a program that dispatches the
  legacy IDL instructions, and refuses a close by another wallet. Depends on 4.4. Superseded by 4.8.
- [ ] 4.8 Make `anchor idl convert`, `anchor idl type`, and `anchor legacy-idl` print the not-supported line, as
  [design.md](design.md), "`convert`, `type`, and `legacy-idl` are not supported", decides, and delete what only they
  used: `client-v2/src/entities/idl/model/anchor-cli` with its fixtures, `features/program-idl/model/legacy.ts`, the
  legacy IDL program fixture, their tests, and the `legacy-fetch` and `legacy-close` event values. Verify: no file
  under `client-v2/src` or `client-v2/e2e` imports the deleted code; the scenarios "anchor idl convert and type" and
  "anchor legacy-idl" pass as Playwright tests; `yarn run check` passes. Depends on 4.4.

## Workflow follow-up

- Ask whether to close the change before opening the PR that ticks 3.2.
