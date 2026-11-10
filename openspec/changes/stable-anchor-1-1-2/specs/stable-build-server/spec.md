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

The build workspace SHALL declare exactly these dependencies, each pinned to one version: `anchor-lang` with the
`allow-missing-optionals`, `anchor-debug`, `event-cpi`, `init-if-needed`, and `lazy-account` features,
`anchor-spl` with the `governance`, `memo`, and `metadata` features, `solana-program`, `bytemuck`, `borsh`,
`spl-token-interface`, `spl-token-2022-interface`, `spl-associated-token-account-interface`, `spl-pod`, `spl-token`,
`spl-token-2022`, `spl-associated-token-account`, `spl-token-group-interface`, `spl-token-metadata-interface`,
`spl-transfer-hook-interface`, `spl-tlv-account-resolution`, `spl-type-length-value`, `mpl-bubblegum`,
`mpl-token-metadata`, `pyth-sdk`, `arrayref`, `borsh-derive`, `bytemuck_derive`, `num-derive`, `num-traits`, `serde`,
and `thiserror`. No dependency SHALL use the `*` version, and the lockfile SHALL hold one version of `solana-program`.

`spl-token-2022` SHALL share its `spl-token-2022-interface` version with `anchor-spl`, so its state types are the ones
`anchor_spl::token_interface` dereferences to. `thiserror` SHALL be the version the `anchor-lang` prelude re-exports,
since a second version makes `thiserror::` ambiguous in a program that imports the prelude.

Four crates SHALL stay below their newest release, since each newer release breaks interop with `anchor-spl` or
`anchor-lang` 1.1.2. Each newer release was relocked from the committed lock, which kept one `solana-program` 3.0.0 and
`anchor-lang` and `anchor-spl` at 1.1.2, and built with the Solana 3.1.10 toolchain:

| Crate | Pinned | Newer releases and the error each hits |
| ----- | ------ | -------------------------------------- |
| `spl-token-2022` | 10.0.0 | 11.0.0 and 11.1.0 depend on `spl-token-2022-interface` 3, so `spl_token_2022::state::Mint` is not the type `anchor_spl::token_interface::Mint` dereferences to: `` E0308 expected `&Mint`, found `&InterfaceAccount<'_, Mint>` ``. 12.0.0 depends on `spl-token-2022-interface` 4: with a fresh lock it fails the same way, and relocked from the committed lock its `spl-token-confidential-transfer-proof-extraction` 0.7.0 fails first with `` E0308 expected `Instruction`, found `solana_instruction::Instruction` `` |
| `spl-token-group-interface` | 0.7.1 | 0.7.2 changes `TokenGroup::update_authority` to `MaybeNull<Pubkey>`, and `spl-token-2022` 10.0.0 fails: `` E0308 expected `&OptionalNonZeroPubkey`, found `&MaybeNull<Pubkey>` `` |
| `spl-token-metadata-interface` | 0.8.0 | 1.0.0 and 1.0.1 compile, but `spl-token-2022` 10.0.0 implements `Extension` only for 0.8's `TokenMetadata`, so reading the metadata extension fails: `` E0277 the trait bound `TokenMetadata: Extension` is not satisfied `` |
| `thiserror` | 1.0.69 | `anchor-lang` 1.1.2 depends on `thiserror` ^1 and its prelude re-exports it. 2.0.18 to 2.0.21 fail with `` E0659 `thiserror` is ambiguous ``; 2.0.0 to 2.0.17 do not resolve, since `spl-list-view` 0.1.1 requires ^2.0.18 |

The Anchor 0.29 crate list's remaining crates stay out, because no release of any of them supports Solana 3:

| Crate | Newest release and what it needs |
| ----- | -------------------------------- |
| `pyth-sdk-solana` | 0.10.6 accepts `solana-program` >=1.10 but fails to build on 3.0.0: it derives borsh 0.10 traits on `Pubkey`, which Solana 3 implements for borsh 1 only, `` the trait bound `Pubkey: BorshSerialize` is not satisfied `` |
| `spl-account-compression` | 1.0.0 requires `anchor-lang` ^0.31 and `solana-program` ^2 |
| `mpl-token-auth-rules` | 1.5.1 requires `solana-program` <1.19 and borsh <0.11 |
| `switchboard-solana` | 0.30.4 requires `anchor-lang` ^0.30.1, which requires `solana-program` ^1.17.3 |
| `switchboard-v2` | 0.4.0 requires `anchor-lang` ^0.28 and `solana-program` >=1.16, <1.17 |

#### Scenario: A native program (manual)

- **WHEN** the Playground's default Native starter, which imports `solana_program`, is sent to `/build`
- **THEN** the response's `stderr` ends without `error: could not compile`

#### Scenario: A Token-2022 program (manual)

- **WHEN** a program that unpacks a `spl_token_2022::state::Mint` with `StateWithExtensions` and invokes
  `spl_token_2022::instruction::transfer_checked` is sent to `/build`
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
