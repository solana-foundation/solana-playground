# Proposal

## Why

An Anchor project exported from the Playground (the export dialog's "Convert
and export", and "Download project" in the guide "Build the IDL locally")
pins `anchor-lang` `=1.1.2` in the program's `Cargo.toml`, the version the
build server compiles with since the move to Anchor 1.1.2, but installs the
TypeScript client the Playground itself runs, `@coral-xyz/anchor` `0.29.0`.
That client does not read the IDL Anchor 1.1.2 writes, so `anchor test` stops
before any test runs (HOO-2964, reported by Sergey Prokhorov on 23 and 24 Nov).

## What Changes

- The exported `package.json` installs `@anchor-lang/core`, the package
  Anchor 1.0 moved its TypeScript client to, at the `anchor-lang` version the
  build server ships (`/crates/versions.json`), exactly as `Cargo.toml` pins
  the crate.
- The converted `client/` and `tests/` files and `migrations/deploy.ts`
  import `@anchor-lang/core`. A file that imports `@coral-xyz/anchor` itself
  gets the new name, and `.accounts(` becomes `.accountsPartial(`, since the
  1.x client's types refuse the accounts it resolves itself.
- `Anchor.toml` gets `[toolchain] anchor_version` at that version and
  `package_manager = "yarn"`, and `[features] resolution = true` in place of
  `seeds = false`, which Anchor 1.x no longer reads.
- A converted file that mentions the word "anchor" (`describe("hello_anchor")`)
  still gets the `anchor` import it uses.

The Playground's own runtime keeps the 0.29 client; moving it is a separate,
larger task.

## Impact

`client-v2/src/frameworks/anchor/export.ts` and `common.ts`
(`getJSDependencies`, `fetchCrateVersion`). The Seahorse export reuses the
Anchor conversion and changes with it.
