# Tasks

## 1. Dual IDL reader (HOO-1765)

- [x] 1.1 `entities/idl`: detect the version, map a 1.x IDL onto the 0.29 shape, instantiate generics, refuse custom discriminators; unit tests on a real Anchor 1.1.2 IDL check the 0.29 coder's bytes against the 1.x discriminators. Plan: [plans/1-dual-idl-reader.md](plans/1-dual-idl-reader.md)
- [x] 1.2 Readers go through it: `PgProgramInfo.callableIdl()`, `getAnchorProgram`, Interact and its surface (the refused notice), `InteractBody`'s storage sync, the JS runtime (`pg.program`, `anchor.workspace`, `target/types`), Monaco's program types, the assistant bridge, lessons and the known-programs list. Depends on 1.1.
- [x] 1.3 The From-seed generator derives with the seed program (`pda.programId`), and an account with a fixed `address` is pre-filled. Depends on 1.1.
- [ ] 1.4 (manual) On the scope/users-work preview, one program built with Anchor 1.x and one with 0.29 show their instructions and accounts in Interact and call successfully on devnet, before the users-work landing; a client script run against a refused IDL throws its reason from `pg.program` and `anchor.workspace`. Depends on 1.2 and 1.3 being on the preview.
