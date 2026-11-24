# Spec Delta

## ADDED Requirements

### Requirement: The Program id block says the account stores the keypair

Open, the "Program id" block SHALL show the note "When you are signed in,
your account stores this keypair, so the program id is the same on every
device." under the upgrade-authority hint. Sync stores the program keypair
unencrypted on purpose, and the note is how the user learns it.

#### Scenario: The note shows in the open block (manual)

- **WHEN** the "Program id" block is open
- **THEN** it shows "When you are signed in, your account stores this
  keypair, so the program id is the same on every device."
- Pinned by
  client-v2/src/features/program-keypair/ui/BaseProgramKeypair.test.tsx:
  "says that a signed-in account stores the keypair"
