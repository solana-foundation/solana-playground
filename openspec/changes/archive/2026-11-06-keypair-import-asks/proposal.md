# Proposal

## Why

Importing a keypair file replaced the project's program keypair and removed its custom id at once, while "New keypair" asks first and offers to save the old keypair. A wrong `program-keypair.json` dropped over a vanity keypair of a program not yet deployed deleted the only copy, and the next push uploaded the new one over the account's. Raised in the SF#76 review (6 Nov).

## What Changes

- An import over an existing keypair or custom id asks first, in the same dialog "New keypair" uses, titled "Replace the program keypair?", with "Save keypair" for the current one and "Replace". An import into a project with neither applies at once, as before.
- No telemetry event changes: `keypair_imported` still fires once the keypair is replaced, and a cancelled import sends nothing.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `client-v2-program-keypair`: the import asks before it replaces a keypair or a custom id.

## Impact

- Code: `features/program-keypair/ui/ProgramKeypair.tsx`, `BaseProgramKeypair.tsx` and their tests.
- Out of scope: a drag of several files, or saving the replaced keypair automatically.
