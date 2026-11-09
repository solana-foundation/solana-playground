# Spec Delta

## Purpose

What the stable `/build` route of the build server compiles user programs against, which crates a program may
depend on, and what its response carries.

## ADDED Requirements

### Requirement: The stable route compiles against Anchor 1.1.2

The stable `/build` route SHALL compile a submitted program with the Solana 3.1.10 toolchain against `anchor-lang`
and `anchor-spl` 1.1.2, resolved from a committed lockfile with no network access during the build.

#### Scenario: An Anchor 1.1.2 program (manual)

- **WHEN** the Playground's default Anchor starter, written for Anchor 1.1.2, is sent to `/build`
- **THEN** the response's `stderr` ends without `error: could not compile`, and `/deploy/<uuid>` returns the
  program binary

#### Scenario: A program written for Anchor 0.29 only (manual)

- **WHEN** a program that calls an API Anchor removed after 0.29 is sent to `/build`
- **THEN** the response's `stderr` holds the compiler error that names the missing item

### Requirement: A program may depend only on the pinned crate set

The build workspace SHALL declare exactly these dependencies, each pinned to one version: `anchor-lang`,
`anchor-spl` with the `governance`, `memo`, and `metadata` features, `solana-program`, `bytemuck`, `borsh`,
`spl-token-interface`, `spl-token-2022-interface`, and `spl-associated-token-account-interface`. No dependency SHALL
use the `*` version.

#### Scenario: A native program (manual)

- **WHEN** the Playground's default Native starter, which imports `solana_program`, is sent to `/build`
- **THEN** the response's `stderr` ends without `error: could not compile`

#### Scenario: An import outside the set (manual)

- **WHEN** a program that imports `switchboard_solana` is sent to `/build`
- **THEN** the response's `stderr` holds the unresolved crate error that names `switchboard_solana`

#### Scenario: The manifest is read (manual)

- **WHEN** a reviewer reads `server/programs/Cargo.toml`
- **THEN** every dependency carries an exact version, and the list matches the requirement

### Requirement: The stable route builds no IDL

The stable `/build` route SHALL NOT compile or run the `idl-build` feature and SHALL NOT parse the program source for
an IDL. Every response SHALL carry the key `idl` with the value `null`, so clients that read the key keep parsing
the response.

#### Scenario: An Anchor program is built (manual)

- **WHEN** an Anchor program that compiles is sent to `/build`
- **THEN** the response is HTTP 200 with the keys `stderr`, `uuid`, and `idl`, and `idl` is `null`

#### Scenario: The server's dependencies are read (manual)

- **WHEN** a reviewer reads `server/Cargo.toml`
- **THEN** it has no `anchor-syn` dependency
