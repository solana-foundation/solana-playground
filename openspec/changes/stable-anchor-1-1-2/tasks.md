# Tasks

All tasks land in one PR (design.md, "Migration Plan"). Group 1 and tasks 2.1, 2.3, and 2.4 may run at the same
time. Every task: ticket to file.

## 1. Stable build server

- [x] 1.1 Replace `server/programs/Cargo.toml`'s dependencies with the crates the `stable-build-server` requirement
  "A program may depend only on the pinned crate set" lists, each at the version its tables name or its newest
  release, and the removed crates named in a comment, port `server/programs/default/src/lib.rs` to Anchor 1.1.2, and regenerate `server/programs/Cargo.lock` with
  Solana 3.1.10's `cargo-build-sbf`. Verify: `cargo-build-sbf --manifest-path server/programs/Cargo.toml --offline`
  succeeds, and `anchor-lang`, `anchor-spl`, and `solana-program` in the lock match
  `server/templates/anchor-1.1.2/Cargo.lock`.
- [x] 1.2 Set `SOLANA_VERSION` to 3.1.10 in `server/Dockerfile`. Verify: the image builds and its
  `cargo-build-sbf --manifest-path programs/Cargo.toml` step passes. Depends on 1.1.
- [x] 1.3 Remove the IDL parsing from `server/src/program.rs` (`build`), type `idl` in `server/src/routes/build.rs`
  as `Option<serde_json::Value>` that is always `None`, keep the request `flags` accepted, and drop `anchor-syn` from
  `server/Cargo.toml`. Verify: `cargo fmt --check` and `cargo clippy` in `server/` pass, and a local `/build` of the
  default program returns HTTP 200 with `"idl": null`. Depends on 1.1.
- [x] 1.4 Build the default Anchor starter, every Anchor and native tutorial in `client/public`, and one Seahorse
  starter against the local server from 1.3. Verify: a table in the PR description lists each with pass or the
  first compiler error. Tutorial fixes go to the assets repository, not this change. Depends on 1.3 and 1.5.
- [x] 1.5 Add `solana-program` (`=3.0.0`, the version the lock already resolves) to `server/programs/Cargo.toml` and
  regenerate the lock. Verify: the default Native starter and Hello Solana build through `/build` with their
  original `use solana_program::…` imports, and `cargo-build-sbf --offline` in the image passes. Depends on 1.1.

## 2. client-v2 IDL build guide

- [x] 2.1 Add the `idl-build` feature to the program `Cargo.toml` in `client-v2/src/frameworks/anchor/export.ts`,
  with `anchor-spl/idl-build` when the source contains `anchor_spl::`. Verify: a unit test covers a program with
  and without `anchor_spl::`.
- [ ] 2.2 Run the Docker and local methods' commands by hand on an exported default starter, on macOS (Apple
  Silicon) and on Linux. Record the image's entrypoint, user, and architectures, and whether `--user` is needed, in
  design.md under "Docker command". Verify: both methods leave the IDL JSON at the path the last step names, and
  design.md states the final commands. Depends on 1.1 and 2.1.
- [x] 2.3 In `client-v2/src/commands/build/build.ts` (`build`), pass `idl` to `PgProgramInfo.update` only when it is
  not `null`. Verify: `build.test.ts` covers both scenarios of "A build without an IDL keeps the IDL the browser
  holds", and the `null` case fails against the code before the change.
- [x] 2.4 Create `client-v2/src/features/idl-build-guide`: `model/versions.ts`, `model/steps.ts`,
  `model/telemetry.ts` declaring the five events with doc comments, the `idl-build-guide: "idl_guide"` entry in
  `shared/lib/telemetry/prefixes.ts`, `ui/BaseIdlBuildGuide.tsx`, `ui/IdlBuildGuide.tsx`, and `index.ts`. Verify:
  a test fails when `model/versions.ts` differs from `server/programs/Cargo.lock` or `server/Dockerfile`; render
  tests cover method switching, the last step, download success, and the `unknown-framework` failure; telemetry
  tests assert the scenarios of "The guide reports how it is used" and "The guide reports the project
  download" through the memory provider; and
  `src/app/slice-structure.test.ts` passes. Commands are final after 2.2. Depends on 1.1 and 1.2 for the versions.
- [x] 2.5 Render `IdlBuildGuide` beside `IdlActions` in the Build, Deploy, and Interact stages under
  `client-v2/src/views/flow/stages`, with `surface` set per stage, and change the `no-idl` copy in `BaseInteract.tsx`
  to say the build does not produce an IDL. Verify: `BaseInteract.test.tsx` and `BaseDeploy.test.tsx` find the
  button by its `aria-label`, and Playwright tests named `client-v2-idl-build-guide: Interact without an IDL` and
  `client-v2-idl-build-guide: Opening the guide` pass. Depends on 2.4.
- [x] 2.6 Replace "The IDL below reflects this build." in `BaseBuild.tsx` with the no-IDL message and the guide
  button, and, while no IDL is held, show no "Download IDL" and put the guide button in its place in the downloads
  row. Verify: tests for both scenarios of "The Build stage does not claim an IDL it lacks" in
  `BaseBuild.test.tsx`, the second failing when the guide button is missing from the row. Depends on 2.5.
- [ ] 2.7 Make a lesson step checked against the IDL show "Build the IDL locally" while no IDL is held, and run the
  lesson check again whenever the held IDL changes. Depends on 2.4.
  Waits for the build backend that returns an IDL again, so this change carries no lessons delta.
- [ ] 2.8 Add `lesson` to the guide's `surface` values and pass it from the lesson surfaces. Depends on 2.7.
  Waits for the build backend that returns an IDL again, as 2.7 does.

## 3. Integration

- [x] 3.1 Make `generate-crates.mjs` (`generateDependencies`) also generate the non-proc-macro dependencies the
  supported crates reach in `server/programs/Cargo.lock`, then run `yarn generate`. Verify: no "not found"; the
  `client-v2-editor-crates` manual scenarios for the Anchor prelude, `Pubkey::find_`, and the re-exported
  `solana_program` items pass in `yarn dev`; the size of `public/crates` before and after, and the time from opening
  the Native starter to the first resolved hover, are recorded in the PR. Depends on 1.5, 3.4, and 3.5.
- [x] 3.4 Record each generated crate's enabled features from `cargo metadata`'s resolution in
  `generate-crates.mjs`'s output, and set `feature="<name>"` for each in `wasm/rust-analyzer/src/world_state.rs`
  (`add_crate`); rebuild with `yarn setup`. Verify: the "A feature-gated item" scenario, `msg!` and `pubkey::Pubkey`
  unmarked in the Native starter, and the wasm crate's `cargo fmt --check` passes (clippy is out: no CI job lints
  that crate, and its existing lints go to a separate PR). Depends on 1.5.
- [x] 3.5 Serve a renamed dependency (`alias = { package = "x" }`) under its alias: `generate-crates.mjs` writes the
  resolved version's source as `<alias>.rs` and `<alias>.toml`, and `load_dependency` in `wasm/rust-analyzer` maps
  the alias to that file. Leave a TODO (ticket to file) at the generator, the client loader (`rust-analyzer.ts`
  `cachedNames`), and `get_file_id`, describing keying crates by name and version. Verify: hovering `Pubkey` in the
  Native starter shows its definition from `solana_address`, and `Pubkey::find_` completes in an Anchor project.
  Depends on 3.4.
- [x] 3.2 Run `yarn run check` in `client-v2`, `yarn spec:validate`, and `cargo fmt --check` and `cargo clippy` in
  `server/`. Run `yarn bundle:info` after a real-wasm `build-fast` if bundle sizes move. Verify: all pass, and the PR
  description's "Bundle size" line explains each moved row or says none moved. Depends on every task above.
- [x] 3.3 Build the default Anchor starter's IDL with the guide's Docker method, upload it in Interact, and call
  `initialize`. Verify: the transaction succeeds on localnet; devnet is a manual check before merge, since its faucet
  is closed. Depends on 2.2 and the change `dual-idl-reader`.

## Workflow follow-up

- Ask whether to close the change before opening the PR that ticks 3.2.
- After merge, tag the merge commit so `cicd.yml` deploys the server.
