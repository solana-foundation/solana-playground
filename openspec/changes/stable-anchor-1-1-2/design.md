# Design

## Context

See [proposal.md](proposal.md), section "Why". State this design depends on, read at `foundation/master` 330e3c75f:

- `server/src/program.rs` (`build`) copies `server/programs/Cargo.{toml,lock}` per concurrency slot, runs
  `cargo-build-sbf --offline`, then calls `anchor_syn::idl::parse::file::parse` on `src/lib.rs` when the source
  contains `anchor_lang`.
- `server/Dockerfile` installs Solana through `release.anza.xyz` with the `SOLANA_VERSION` argument and warms the
  cargo cache with `cargo-build-sbf --manifest-path programs/Cargo.toml`.
- `server/templates/anchor-1.1.2/Cargo.lock` already resolves `anchor-lang` and `anchor-spl` 1.1.2 against
  `solana-program` 3.0.0. `anchor-spl` 1.1.2 depends on the `*-interface` token crates, not on `spl-token` and
  `spl-token-2022`.
- `client-v2/scripts/generate-crates.mjs` reads `server/programs/Cargo.lock` to produce the editor crates and
  `/crates/versions.json`, which the Anchor export (`getRustDependencies` in `client-v2/src/frameworks/common.ts`)
  uses for dependency versions.
- `client-v2/src/commands/build/build.ts` (`build`) writes `result.idl` into `PgProgramInfo` on every build.

## Goals / Non-Goals

**Goals:**

- One lockfile is the source of the server's crate versions, the editor's crates, and the export's versions.
- A user can go from "no IDL" to an uploaded IDL without leaving the Flow for documentation.

**Non-Goals:**

- Running `idl-build` anywhere on the server, including a separate sandboxed step.
- Detecting whether an uploaded IDL matches the source the user last built.

## Decisions

**Seed the lockfile from the template's resolution.** `server/programs/Cargo.toml` lists the crates of the
`stable-build-server` requirement "A program may depend only on the pinned crate set", and its `Cargo.lock` is generated with the Solana 3.1.10 toolchain, then checked so that
`anchor-lang`, `anchor-spl`, and `solana-program` match `server/templates/anchor-1.1.2/Cargo.lock`. Alternative:
copy the template's lockfile. Rejected: the stable set adds `borsh`, `solana-program`, and the interface crates as
direct dependencies, so the lock differs. `solana-program` is direct because native programs import it.

**Each restored crate takes its newest release that keeps `anchor-spl` interop.** A crate of the Anchor 0.29 list
stays when a release builds on Solana 3 with the lock holding one `solana-program` 3.0.0 and `anchor-lang` and
`anchor-spl` at 1.1.2, and every probe program builds, including one that passes an
`anchor_spl::token_interface::Mint` where a `spl_token_2022::state::Mint` is expected. `spl-token-2022`,
`spl-token-group-interface`, `spl-token-metadata-interface`, and `thiserror` stay below their newest release; the
spec's table names the error each newer release hits. Alternative: take the newest release of each. Rejected: a
program then holds two copies of the token state types, and `anchor-spl`'s accounts no longer convert to
`spl-token-2022`'s.

**The editor gets every reachable crate.** `solana-program` 3.0 re-exports separate crates (`solana-pubkey`,
`solana-msg`, `solana-account-info`, and others), and `generate-crates.mjs` generated only the supported crates and
their proc macros, so Rust Analyzer could not follow `solana_program::msg` to its definition. The generator also
emits the non-proc-macro dependencies the supported crates reach in the lock. Alternative: list the `solana-*`
crates by hand. Rejected: the set changes with every `solana-program` release. Under a proc-macro crate only
proc-macro dependencies are generated, since the editor does not need `syn` and its kin; a reached crate the
expansion tool cannot read is skipped with a warning.

**Rust Analyzer gets each crate's resolved features.** Those crates gate items behind Cargo features
(`#[cfg(feature = "alloc")] macro_rules! msg`), and the Rust Analyzer wasm (`wasm/rust-analyzer/src/world_state.rs`,
`add_crate`) set no `feature` cfg, so every gated item vanished. `generate-crates.mjs` records the features the
lock's resolution enables per crate (from `cargo metadata`), and `add_crate` sets `feature="<name>"` for each.
This edits `wasm/`, a deliberate exception like `server/`. Alternative: delete `#[cfg(feature = ...)]` from the
generated sources. Rejected: an item with a `cfg(not(feature))` twin would be defined twice. The features ride in
the served `<name>.toml` under `[package.metadata.solana-playground]`, so the wasm reads them from the manifest it
already parses. Not `[package.metadata.playground]`: serde, syn, tokio, and other crates declare that table for the
Rust Playground, so a second one is a duplicate TOML table. Not `solpg`: the project names new things after Solana Playground, not `solpg`.

**Renamed dependencies are served under their alias.** `solana-pubkey` 3.0 re-exports `solana_address::Address`, and
`solana-address` 1.1.0 is only `pub use solana_address_v2::*`, its 2.x release under a renamed dependency. The
generator, the client loader, and the wasm identify a crate by name, so 2.x had no file. The generator writes a
renamed dependency's resolved source as `<alias>.rs`, and `load_dependency` maps the alias. Alternative: identify
crates by name and version in all three places. Deferred (HOO-2754, TODOs at each site): correct for every
case, but a larger change to the crate graph than this change needs.

**`CopyButton` reports success.** The installed `CopyButton` had no success callback, and
`idl_guide_command_copied` counts successful copies only. `onCopied` is added in `design-system` and reinstalled with
`yarn ds-add copy-button`. Alternative: count clicks. Rejected: a failed clipboard write would count.

**Keep `idl` in the response, always `null`.** `client/` (upstream's, not edited) and `client-v2` read the key.
Removing it would turn every response into a parse of an absent field in `client/`. The request's `flags`
(`seedsFeature`, `noDocs`, `safetyChecks`) are accepted and ignored for the same reason. The response type becomes
`Option<serde_json::Value>`, so `anchor-syn` leaves `server/Cargo.toml`. IDL generation stays off until the build
backend that returns an IDL replaces this route; tasks 2.7 and 2.8 of [tasks.md](tasks.md) wait for that backend.

**`client-v2` replaces the IDL only when the build returns one.** `build` passes `idl` to `PgProgramInfo.update`
only when it is not `null`. The unstable route still returns IDLs, and those still replace the held one.
Alternative: never overwrite. Rejected: the unstable route's IDL is fresher than an upload.

**One version declaration, checked against the server.** `shared/config/build-server.ts` declares the
Anchor and Solana versions the guide's commands and `anchor --version` use. It sits in `shared`, not in the guide's
slice, because importing it through the slice's `index.ts` pulled the guide's UI into the terminal's chunk. A test
beside it reads `server/programs/Cargo.lock` and
`server/Dockerfile` and fails when either version differs. Alternative: read the versions at runtime from
`/crates/versions.json`. Rejected: it carries crate versions only, not the Solana CLI version, and the guide would
render without commands until the fetch resolves.

**A feature slice with a Base pair, opened from the legacy Flow.** `features/idl-build-guide` holds
`ui/BaseIdlBuildGuide.tsx` (steps, method, copy, and download handlers through props), `ui/IdlBuildGuide.tsx`
(export, telemetry, logger `idl-build-guide:ui`), `model/steps.ts` (the step table per method, ids matching the
`step` event values), `model/telemetry.ts`, and `index.ts`. It uses the installed `dialog`, `radio-group`, `drop-zone`,
`code-block`, and `copy-button` from `shared/ui`; copy failures go through `reportButtonFailure("copy the command")`.
`views/flow/stages` (a legacy root) renders `IdlBuildGuide` beside `IdlActions`, passing `surface`.

**Download reuses `PgFramework.exportWorkspace({ convert: true })`.** The export already zips the Anchor layout. The
change adds the `idl-build` feature to the program `Cargo.toml` in `frameworks/anchor/export.ts`, with
`anchor-spl/idl-build` when the program source contains `anchor_spl::`. Errors map to `reason` by
`PgWorkspace.errors.CURRENT_NOT_FOUND` (`no-workspace`) and the export's unknown-framework error
(`unknown-framework`); anything else is `other` and is logged with `report: true`.

**Docker command.** `docker run --rm --platform linux/amd64 -v "$PWD":/workdir -w /workdir
quay.io/ottersec/anchor:v<anchor> anchor idl build -o idl.json`. The output sits at the project root because a
fresh export has no `target/idl`, and `anchor idl build -o` does not create folders; the local method writes the
same path. The local build compiles what the server compiles because the export carries two files of the server's:
its `Cargo.lock`, which `generate-crates.mjs` serves as `/crates/Cargo.lock`, and the features
`server/programs/Cargo.toml` declares on each direct dependency, which `generate-crates.mjs` writes to
`/crates/features.json` from `cargo metadata` and `getRustDependencies` writes into the program's `[dependencies]`.
Without the lock, cargo resolves newer transitive crates that fail to compile; without the features, a program using
`init_if_needed`, `event-cpi`, or `lazy-account` does not compile, and one using `spl_token_2022` links a second
`entrypoint`. The Anchor and native exports both ship them. `--platform` keeps Apple Silicon on the
published architecture. Verified on macOS (Apple Silicon) on 2026-11-11: the command builds the exported Anchor
starter and writes `idl.json`. Linux is unverified: task 2.2 stays open for whether the image writes `idl.json` and
`target/` as `root` there, which would add `--user "$(id -u):$(id -g)"` to the command.

## Risks / Trade-offs

- [Rust Analyzer's toolchain cannot parse Anchor 1.1.2 or `solana-program` 3 sources] → task 3.1 runs
  `yarn generate` and opens the starter in the editor. The Anchor prelude resolves; `Pubkey::find_` needed
  `solana-program` as a direct dependency (task 1.5).
- [Tutorials fail on 1.1.2] → task 1.4 builds each against the new server and the PR lists the outcomes. Fixes land
  in the assets repository; developers bump the submodule and run `update-static`.
- [Lesson steps checked against the IDL cannot pass without a build IDL] → accepted in this change; offering the
  guide on such a step waits for the build backend that returns an IDL again (tasks 2.7 and 2.8).
- [The guide's IDL is the 0.30+ format, which `@coral-xyz/anchor` 0.29 does not read] → the change
  `dual-idl-reader` maps a 1.x IDL onto the 0.29 shape in `entities/idl` (`readIdl`), and refuses one the 0.29 coder
  cannot call, with the reason.
- [The image writes `target/` as root on Linux hosts] → the guide's last step names the file; task 2.2 records
  whether `--user "$(id -u):$(id -g)"` is needed and adds it to the command if so.
- [An uploaded IDL goes stale after the user edits instructions] → accepted: nothing prompts a rebuild; after changing
  instructions the user builds and uploads the IDL again.

## Migration Plan

1. Merge the one PR into `master`. Vercel deploys `client-v2` on the push.
2. Tag the merge commit so `cicd.yml` deploys the server. Until the tag deploys, the old server still returns
   0.29-format IDLs, which replace a held IDL as before this change; `entities/idl` (`dual-idl-reader`) reads both
   formats.
3. Rollback: revert the PR and tag the revert.

## Open Questions

- Whether `--platform linux/amd64` is needed once the image publishes an arm64 variant. Task 2.2 records the
  manifest; the flag stays until it does.
