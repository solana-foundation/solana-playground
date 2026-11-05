# Plan: dual IDL reader (tasks 1.1–1.3, HOO-1765)

Goal: Interact, `getAnchorProgram` and the JS runtime call an Anchor 1.x
program through the 0.29 client. Mode: inline (executing-plans), TDD.

## 1.1 `client-v2/src/entities/idl`

Files: `model/types.ts` (the 1.x IDL types and `IdlReading`), `model/read.ts`
(`readIdl`, detection, memo, refusal log), `model/to-legacy.ts` (the
mapping), `index.ts`. Fixtures: `model/__fixtures__/` holds Anchor's own
v1.1.2 IDLs (`tests/idl/idls/{idl,generics,relations}.json`,
`docs-v2/.../_pda/idl.json`, `tests/declare-program/idls/amm_v3.json`).

Tests first (`model/read.test.ts`, a file because it drives the 0.29 coder
across modules):
1. A 0.29 IDL reads as `v029`, the same object.
2. Not an IDL (`{}`, `{ instructions: 1 }`) reads as `refused`.
3. Every fixture reads as `v1`; for every instruction the 0.29
   `BorshInstructionCoder` encodes random-free sample args (zeroed values
   built from the converted types) and the first 8 bytes equal the 1.x
   `discriminator`; the rest equals the borsh bytes of the same values
   encoded by a coder built from the converted IDL (round trip decode).
4. Accounts: `BorshAccountsCoder.accountDiscriminator(name)` equals each
   1.x account's `discriminator`; events likewise.
5. Generics: `generics.json`'s `generic` arg type is
   `GenericType<u32, u64, 10>` with `arr: [u8; 10]`.
6. Seeds: pda.json's const seed is `{ kind: "const", type: "string",
   value: "hello_world" }`, its account seed `publicKey`; amm_v3's
   `pda.program` const becomes a base58 `programId`; an arg seed takes the
   arg's type; a nested `account.field` seed takes the field's type.
7. A custom instruction discriminator reads as `refused` naming it.

## 1.2 Readers

`PgProgramInfo.callableIdl()`; replace direct reads in
`program-interaction/program.ts`, `generators/program.ts`,
`js-runtime.ts`, `InteractBody` storage sync, `Interact.tsx` (form +
surface), `views/sidebar/test` callers, `playground-bridge.ts`,
`AssistantComposer.tsx`, `lessons/store.ts` (raw is fine where only stored).
`interact-surface.ts` gains `{ refused: reason }`; `BaseInteract` shows the
notice from the spec. Tests: surface unit test for a refused IDL;
BaseInteract render test for the notice.

## 1.3 Seeds

`createAccountGenerator` uses `acc.pda.programId` (const -> Custom value,
arg/account -> Arguments/Accounts) and a fixed `address` -> Custom value.
Test in `instruction.ts`'s block.

## Gate

`yarn run check` (lint, format, types, unit, spec), no e2e added.
