# Proposal

## Why

The `anchor-1.1.2` build template returns an Anchor 1.x IDL (spec `0.1.0`), and
the stable route is moving to it (HOO-2281). Every IDL reader in client-v2 is
written against the 0.29 shape, so a program built on 1.x shows "This IDL
can't be read" in Interact, or worse, sends a call the program rejects.
HOO-1765 is the foundation of section E (IDL 1.x and seeds) and sits on the
Breakpoint critical path.

## What Changes

- A new entity slice `entities/idl` reads either version: a 0.29 IDL passes
  through unchanged, a 1.x IDL is turned into the 0.29 shape the client
  already understands (names, account flags, types, PDA seeds, events).
- A 1.x IDL the 0.29 coder cannot reproduce byte for byte (a non-default
  discriminator) is refused with a reason instead of being
  called with wrong bytes.
- `PgProgramInfo.idl` keeps the IDL as it arrived (build, Upload IDL,
  on-chain fetch), so Download IDL hands back the real 1.x file. Readers
  (the Interact form and its surface, `getAnchorProgram`, the JS runtime's
  `pg.program`, `anchor.workspace` and `target/types` import, the
  instruction storage sync, the assistant bridge, the test-code generator)
  read through the slice.
- The Interact empty state "This IDL can't be read" names the reason when
  a 1.x IDL is refused.
- A PDA seed's program (`pda.program` in 1.x, `pda.programId` in 0.29) is
  used to derive the address in the From-seed generator, so associated
  token accounts derive correctly.
- No telemetry events change: the slice is an entity, and the Interact
  stage's events are untouched. A refusal is logged under `idl:reader`.

## Capabilities

### New Capabilities
- `client-v2-idl`: which Anchor IDL versions the client reads, how a 1.x
  IDL maps onto the shape the client calls with, and when an IDL is refused.

### Modified Capabilities
- `client-v2-interact`: the "bad IDL" state names why a refused IDL cannot
  be called.

## Impact

- Code: `client-v2/src/entities/idl/` (new), `utils/program-info.ts`,
  `utils/program-interaction/*`, `utils/js-runtime/js-runtime.ts`,
  `views/flow/stages/{Interact,BaseInteract,InteractBody,interact-surface}`,
  `views/sidebar/assistant/bridge/playground-bridge.ts`.
- Dependencies: none added. `@anchor-lang/core` is not taken in: the 0.29
  client keeps building and sending transactions.
- Out of scope: an IDL stored on-chain through the Program Metadata program
  (fetch keeps reading the legacy IDL account); the test generator on 1.x
  (HOO-1767); the build route's toolchain (HOO-2281); 1.x client code that
  imports `@anchor-lang/core` in the JS runtime.
