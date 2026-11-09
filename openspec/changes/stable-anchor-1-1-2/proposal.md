# Proposal

## Why

The stable `/build` route compiles user programs against Anchor 0.29 and Solana 1.17, so a program written for
Anchor 1.x does not build in the Playground. The route also produces the IDL in-process with `anchor-syn`'s
`idl-parse`, which Anchor removed in 0.30: on 1.x the only IDL path is the `idl-build` feature, which compiles and
runs user code on the server. This change moves the stable route to Anchor 1.1.2 without `idl-build`, and gives
users a guided way to build the IDL on their own machine and upload it.

## What Changes

- **BREAKING** `server/programs` moves to Anchor 1.1.2 (`anchor-lang`, `anchor-spl`) and Solana 3.1.10, the pair the
  unstable `anchor-1.1.2` template already uses. The crate list is cut to crates that resolve on Solana 3 and pinned
  exactly: `anchor-lang`, `anchor-spl` (`governance`, `memo`, `metadata`), `solana-program`, `bytemuck`, `borsh`,
  `spl-token-interface`, `spl-token-2022-interface`, `spl-associated-token-account-interface`. A user program that
  imports a removed crate (`switchboard-*`, `pyth-*`, `mpl-bubblegum`, `spl-account-compression`, `clockwork-sdk`,
  and the rest of the "*" list) stops compiling, and so does a native program written against `solana-program` 1.x
  APIs that 3.0 removed.
- **BREAKING** `/build` returns `"idl": null` for every program. The field stays in the response so upstream's
  `client/` and `client-v2` keep parsing it. The server drops its `anchor-syn` dependency.
- The server image installs Solana 3.1.10 in place of 1.17.34; the toolchain files follow it.
- `client-v2` keeps the IDL it already holds when a build returns `null`, so an uploaded IDL survives a rebuild.
  Today `build` overwrites it with the build's `idl`.
- `client-v2`'s Anchor project export writes an `idl-build` feature into the program's `Cargo.toml`, so
  `anchor idl build` works on the downloaded project.
- `client-v2` regenerates its editor crates and export versions from the new `server/programs/Cargo.lock` through
  the existing `generate-crates.mjs`: Rust Analyzer completes against Anchor 1.1.2.
- New feature slice `features/idl-build-guide`: a dialog with two methods to build the IDL locally, Docker with
  `quay.io/ottersec/anchor:v1.1.2`, or a local Rust, Solana and `avm` install, each a list of copyable commands that
  starts with downloading the project and ends at the existing "Upload IDL" action. The Flow's Build, Deploy, and
  Interact stages open it where they offer the IDL.
- The Build stage stops saying the IDL reflects the build: after a successful build it says the build has no IDL and
  offers the guide. While the browser holds no IDL, "Download IDL" is not shown and the guide is offered in its place.
- Lesson steps checked against the program's IDL are left unchanged: offering the guide there waits for the build
  backend that returns an IDL again (tasks 2.7 and 2.8).
- The design system's `CopyButton` gains an `onCopied` callback, so a copy is counted only when it succeeds.
- Telemetry, slice `idl-build-guide`, prefix `idl_guide`: adds `idl_guide_opened`, `idl_guide_method_picked`,
  `idl_guide_command_copied`, `idl_guide_project_downloaded`, `idl_guide_export_failed`. Renames and removes none.

## Capabilities

### New Capabilities

- `stable-build-server`: what the stable `/build` route compiles against, which crates a program may use, and the
  shape of its response, including the absent IDL.
- `client-v2-idl-build-guide`: how `client-v2` tells a user to build an IDL locally, where the guide opens, the
  exported project it relies on, keeping an uploaded IDL across builds, and the guide's telemetry.

### Modified Capabilities

- `client-v2-editor-crates`: the `mpl-token-metadata` exception goes, since the crate is no longer a supported crate.

## Impact

- **Deliberate exception to the project constraint "server/ is not modified".** Production needs Anchor 1.x builds,
  and upstream's newer build backend cannot be configured for production within the time available, so the stable
  backend this fork already deploys is updated in place. `server/programs`, `server/Dockerfile`, `server/Cargo.toml`, `server/src/program.rs`, and
  `server/src/routes/build.rs` change. The unstable routes and templates do not. The same exception covers
  `wasm/rust-analyzer`, which learns each crate's Cargo features so the editor resolves feature-gated items of the
  Solana 3 crates.
- **Depends on the change `dual-idl-reader`**. `anchor idl build` on 1.1.2 writes the IDL format of Anchor 0.30 and
  later, which `client-v2` reads through `entities/idl`, mapped onto the shape of the 0.29 client. Without it, an IDL
  built with the guide passes "Upload IDL" and fails in Interact.
- Production: App Engine deploys the server from a tagged `master` commit (`cicd.yml`), and Vercel deploys
  `client-v2` on every push to `master`. Both halves land in one PR, so no deployment returns `null` IDLs while the
  client still reads them as authoritative.
- Users of upstream's `client/` against this server lose the generated IDL with no guide. `client/` is not edited.
- Users of the default "*" crate list: programs that import a removed crate stop compiling. The build output names
  the missing crate.
- Seahorse (Python) projects compile to Anchor code through the same route; the default Seahorse starter builds on
  Anchor 1.1.2 (task 1.4).
- Tutorials that fail on 1.1.2 are fixed in the assets repository behind the `client/public` submodule. Developers
  bump the submodule and run `update-static`; this change does no work for them.
- Out of scope: Anchor 1.2.x (a later change moves both templates together; its Solana pairing is disputed in
  otter-sec/anchor#5031); IDL generation on the server in any form; the unstable route and its templates; editing
  `client/`; the `REACT_APP_SERVER_URL` requirement, which is its own change on this branch.
