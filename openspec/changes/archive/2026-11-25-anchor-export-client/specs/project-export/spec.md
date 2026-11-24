# Spec Delta

## ADDED Requirements

### Requirement: An exported Anchor project runs on the build server's Anchor version

The Anchor conversion SHALL write a project whose TypeScript client matches
the Anchor version its program compiles with: `package.json` SHALL depend on
`@anchor-lang/core` at the `anchor-lang` version the build server ships, and
never on `@coral-xyz/anchor`; the converted client, tests and migration SHALL
import `@anchor-lang/core`; and `Anchor.toml` SHALL name that version as
`[toolchain] anchor_version`. When the build server's `anchor-lang` version is
unknown, the conversion SHALL fail rather than write a client that may not
match the program.

#### Scenario: anchor test passes in an exported project (manual)

- **WHEN** the user downloads the default Anchor project from the guide
  "Build the IDL locally", and runs `yarn`, `anchor keys sync`,
  `anchor build` and `anchor test` with Anchor 1.1.2
- **THEN** the project's test passes
- Pinned by client-v2/src/frameworks/anchor/export.test.ts: "installs the
  TypeScript client of the program's Anchor version", "imports that client in
  the tests, the client and the migration" and "pins the Anchor CLI in
  Anchor.toml"
