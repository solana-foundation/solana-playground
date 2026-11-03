# Design

## Context

The `anchor-1.1.2` server template (`server/src/templates/anchor.rs`) runs
`anchor idl build` and returns the 1.x IDL (spec `0.1.0`). It differs from the
0.29 IDL that `anchor-syn` 0.29 produced in every reader-facing detail:

| 0.29 | 1.x |
| --- | --- |
| `name`, `version` at the top | `address`, `metadata.{name, version, spec}` |
| camelCase instruction, account and field names | names as written in Rust (snake_case) |
| `isMut`, `isSigner`, `isOptional` | `writable`, `signer`, `optional`, `address`, `relations` |
| `"publicKey"` | `"pubkey"` |
| `{ defined: "Name" }` | `{ defined: { name, generics? } }` |
| `accounts[]` and `events[]` carry their fields | carry a `discriminator`; their fields live in `types` |
| discriminator implied by the name | explicit `discriminator` on instructions, accounts and events |
| seeds typed: `{ kind, type, value \| path }` | untyped: `{ kind: "const", value: bytes }`, `{ kind: "arg" \| "account", path, account? }`; `pda.program` |
| aliases `{ kind: "alias", value }` | `{ kind: "type", alias }`; tuple structs `fields: IdlType[]`; `generics` |

Everything that reads `PgProgramInfo.idl` is written against the 0.29 shape:
the Interact form (`utils/program-interaction`, `views/sidebar/test`,
`InteractBody`), `getAnchorProgram` (0.29 `Program`), the JS runtime
(`pg.program`, `anchor.workspace`, the `target/types` import), the instruction
storage sync, the assistant bridge and the test-code generator.

## Goals / Non-Goals

**Goals:** a 1.x program is callable from Interact and from client scripts
exactly like a 0.29 one; nothing changes for a 0.29 IDL; an IDL that cannot be
called faithfully is refused, never called with wrong bytes.

**Non-goals:** a second Anchor client; reading an IDL stored by the Program
Metadata program; 1.x client code importing `@anchor-lang/core`; the test
generator on 1.x (HOO-1767).

## Decisions

### Map 1.x onto the 0.29 shape, keep the 0.29 client

The rest of the client already understands the 0.29 shape, and the 0.29 coder
reproduces a 1.x program's bytes whenever the discriminators are Anchor's
defaults: `sha256("global:<snake name>")`, `sha256("account:<Name>")`,
`sha256("event:<Name>")`, which is what 1.x writes unless a program overrides
it. So the reader turns a 1.x IDL into a 0.29 one and checks every
discriminator against the default; a mismatch refuses the IDL.

Rejected: adding `@anchor-lang/core` and calling through its `Program` for 1.x
IDLs. It would handle custom discriminators, but the form, the seed generator
and the storage all parse 0.29 types, so the mapping would still be needed for
the form, and the bundle would carry two Anchor clients.

### Store as received, map where read

`PgProgramInfo.idl` keeps what arrived, so Download IDL and a later on-chain
IDL init (HOO-2398) give back the real file, and `program-info.json` syncs the
real file across devices. The slice `entities/idl` exposes
`readIdl(idl): IdlReading`, a union of `{ kind: "v029", idl }`,
`{ kind: "v1", idl, source }` and `{ kind: "refused", reason, version }`,
memoised per IDL object so every render reads the same converted object.
`PgProgramInfo.callableIdl()` returns the 0.29-shaped IDL or `null`, and is
what every 0.29 reader calls.

### Mapping rules

- Names: instruction, account-meta, argument and field names to camelCase
  (as `anchor-syn` 0.29 wrote them; the 0.29 coder snake-cases them back for
  the sighash). An instruction whose camelCase does not hash back
  (`add_2_things`) keeps its name as written. Type, account and event names
  unchanged.
- Accounts: `writable`→`isMut`, `signer`→`isSigner`, `optional`→`isOptional`,
  `relations` camelCased; composite accounts recurse. A fixed `address` is
  kept on the account meta and the form pre-fills it.
- Types: `pubkey`→`publicKey`; `{ defined: { name } }`→`{ defined: name }`;
  aliases inlined at every use; tuple struct fields named `0`, `1`, ...;
  a generic type is instantiated per distinct argument list (`GenericType<u32, u64, 10>`),
  substituting type and const arguments, nested ones included.
- Account types move out of `types` into `accounts`, as 0.29 laid them out,
  unless another type holds one: the 0.29 accounts, types and events coders
  look only in `types`. The instruction coder looks across `accounts` and
  `types` and fails on two matches, so an account type that another type holds
  and an argument reaches stays in `types` only, and is not decoded by name.
  Event types stay in `types` (an argument may name one); `events` repeats
  their fields with `index: false`.
- Seeds: a `const` seed becomes `string` with its text when the bytes are
  printable UTF-8 with no quote and no edge space (the form's `string` parse
  drops quotes), `publicKey` when it is 32 other bytes, else `bytes` with the
  JSON array; an `arg` seed takes the argument's type; an `account` seed is
  `publicKey`. A seed whose path reads into an argument or an account's data
  (a dotted path, or `account` set) is not followed: the account's PDA is
  dropped and the person fills the address. `pda.program` becomes
  `programId` by the same rules.
- `metadata.address` is set from `address` when there is one, as 0.29 wrote
  it for deployed programs.
- A primitive type the 0.29 coder does not encode refuses the IDL.

### Refusal

`readIdl` never throws. A refused reading carries a short reason ("a custom
discriminator on initialize", "an unknown type u512") that Interact shows
in the bad-IDL notice, and is logged once per IDL under `idl:reader` at `warn`.

## Risks / Trade-offs

- A 1.x feature added later that the mapping does not know -> it is refused
  when it touches discriminators or types, and any other throw in the mapping
  refuses the IDL and is reported; anything else passes through
  and may fail at call time. Mitigated by mapping from the published 1.x type
  definitions, field by field, and testing on a real 1.1.2 IDL.
- Zero-copy (`serialization: bytemuck`) accounts decode with borsh in 0.29 too;
  calling instructions is unaffected. Not changed here.
- The memo is per object identity: an IDL replaced by an equal copy is mapped
  again, which is cheap.

## Migration Plan

None: stored IDLs are not rewritten, and a 0.29 IDL reads as before.

## Open Questions

None blocking. Fetching a 1.x IDL from the Program Metadata program belongs
with HOO-2402.
