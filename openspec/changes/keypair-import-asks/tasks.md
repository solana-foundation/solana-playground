# Tasks

## 1. Ask before an import replaces a keypair

- [x] 1.1 An import over a keypair or a custom id opens the replace dialog; "Replace" applies it, closing keeps both. Ticket to file (raised in the SF#76 review). Verify: `ProgramKeypair.test.tsx` "imports a CLI keypair file and clears the custom id", "imports at once when there is nothing to replace", "keeps the current keypair when the import is cancelled".
