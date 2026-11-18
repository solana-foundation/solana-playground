# Tasks

Groups 1 to 4 can start in parallel. Within a group, tasks run in order unless
a task says otherwise. Every task is one PR, and every slice task declares,
describes and emits its spec's events with memory-provider tests.

## 1. Build

- [x] 1.1 Create the `program-build` slice with the `build` prefix, emit
  `build_started`, `build_succeeded` and `build_failed` around
  `commands/build`, and verify with memory-provider tests for each
  `framework` and `reason` (done as `funnel-events` 5.1, HOO-2598)
- [ ] 1.2 Keep the previous IDL when a build fails: the `build` command writes
  `result.idl` into `PgProgramInfo` even after a compile error, so a failed
  build erases the saved IDL; verify with a test of a successful build
  followed by a failed one, failing before the fix (ticket to file)
- [ ] 1.3 Cover the build requirements with e2e specs titled
  `client-v2-program-build: <scenario>`, the build server stubbed with
  `page.route`, and verify they pass (ticket to file; after 1.1 and 1.2)

## 2. Deploy

- [ ] 2.1 Create the `program-deploy` slice with the `deploy` prefix and emit
  `deploy_started`, `deploy_succeeded` and `deploy_failed`; verify with
  memory-provider tests per `phase` (ticket to file)
- [ ] 2.2 Track deploy state per cluster so a program on Devnet shows as not
  deployed on Testnet; verify with the "Devnet deploy is not on testnet"
  scenario (ticket to file; after 2.1)
- [ ] 2.3 Keep every deploy to Mainnet Beta refused, whichever wallet pays
  and whether the Deploy stage, the terminal `deploy` command or the
  assistant starts it. The refusal is in the main spec, as the requirements
  "Deploys to mainnet are refused" and "The Deploy stage points mainnet to
  the user's machine" of `mainnet-deploy-warning`, and this task adds no
  dialog to it. Emit no `deploy_started` and no outcome event for a refused
  deploy; verify with the "An extension wallet is blocked too", "The
  assistant and the terminal are blocked" and "Deploy from your machine on
  mainnet" scenarios (ticket to file; after 2.1)
- [ ] 2.4 Add the deploy script, the IDL upload script and the README steps to
  the export of every framework; verify by running both scripts against
  `solana-test-validator` and with the "Scripts in the export" scenario
  (ticket to file)
- [ ] 2.5 Add program keypair export, import and create to the Deploy stage,
  with the warning before replacing a deployed program's keypair; verify with
  the "Import a keypair" scenario (ticket to file; after 2.1)
- [ ] 2.6 Make the `solana` terminal command refuse a program deploy or a
  program management transaction on the cluster the command resolves to when
  that is Mainnet Beta, a `-u` flag included, and keep `solana program
  deploy` and `write-buffer` unavailable. The refusal of `anchor idl` writes
  on Mainnet Beta shipped in #131, as the requirement "Anchor IDL writes to
  mainnet are refused" of `mainnet-deploy-warning`, and this task adds
  nothing to it; verify with the "Solana program deploy is unavailable" and
  "A URL flag cannot reach mainnet" scenarios (ticket to file)

## 3. IDL

- [ ] 3.1 Extend the `program-idl` slice, which the `terminal-anchor-idl`
  change creates with the `idl` prefix and the IDL upload: recognise Anchor
  before 0.30, Anchor 0.30+ and Codama, and refuse anything else with a
  reason; verify with unit tests on fixtures of each format and
  `idl_load_failed { reason: "invalid" }` (ticket to file; after task 1.1 of
  `terminal-anchor-idl`)
- [ ] 3.2 Read the IDL from the Program Metadata program and the Anchor IDL
  account for any program id on the selected cluster. Read the Program
  Metadata account through `fetchProgramMetadataIdl` of the `program-idl`
  slice (not `fetchPublishedIdl`, which sends the events of
  `anchor idl fetch`), and write no second reader of that account; the read
  of the Anchor IDL account stays this task's own work. First settle the
  open question about a URL data source in [design.md](design.md), "Open
  Questions"; verify with the "A program with no IDL on chain" scenario and
  `idl_loaded` per `source` (ticket to file; after 3.1 and task 4.2 of
  `terminal-anchor-idl`)
- [ ] 3.3 Add the IDL source picker (`idl-source`) with the default order and
  the legacy mark; verify with the "Both on-chain IDLs exist" scenario
  (ticket to file; after 3.2)
- [ ] 3.4 Add the paste editor (`idl-paste`) beside the file picker, both
  giving the same local IDL; verify with the "Paste an edited IDL" scenario
  (ticket to file; after 3.1)
- [ ] 3.5 Upload the project's IDL on the deployed cluster by calling
  `uploadProjectIdl`, the entry of the `program-idl` slice, which writes the
  program's canonical Program Metadata account and checks the upgrade
  authority. On Mainnet Beta send nothing and record the attempt, as the
  requirements "An IDL upload sends its events" and "A failed upload names
  its reason" of `terminal-anchor-idl` describe for a command refused on
  mainnet; verify on Devnet with the upload scenarios and `idl_uploaded`,
  and with the "Mainnet upload sends nothing" scenario (ticket to file;
  after 3.2)

## 4. Interact

- [ ] 4.1 Create the `program-interact` slice with the `interact` prefix and
  the program id field (`interact-program-id`) that opens any program on the
  cluster; verify with the "Someone else's program" scenario (ticket to file;
  after 3.2)
- [ ] 4.2 Add Simulate, simulate before send (`simulate-before-send`,
  `simulate-skipped-warning`) and the result view with logs, compute units,
  IDL error names and the explorer link, emitting `interact_simulated`,
  `interact_sent` and `interact_failed`; verify with the simulate and result
  scenarios (ticket to file; after 4.1)
- [ ] 4.3 Derive PDAs with the program the seeds name, not only the current
  program; verify with the "Seeds from another program" scenario (ticket to
  file)
- [ ] 4.4 Add the first-send confirmation on Mainnet Beta
  (`interact-mainnet-confirm`); verify with the "First mainnet send"
  scenario (ticket to file; after 4.2)
- [ ] 4.5 Cover the kept Interact requirements (argument types, known
  accounts, From seed, Localnet) with e2e specs and verify they pass (ticket
  to file; after 4.1)

## 5. Modern IDL formats

The stable build server builds with Anchor 1.1.2 (change
`stable-anchor-1-1-2`), so the IDL of a project built in the playground is in
the Anchor 0.30+ format. Each task waits only for the task it names.

- [ ] 5.1 Build the Interact form from an Anchor 0.30+ IDL, PDA seeds
  included; verify with a 0.30.1 fixture and the "A PDA follows its seed"
  scenario (ticket to file; after 4.1)
- [ ] 5.2 Build the Interact form from a Codama IDL, PDA seeds included;
  verify with a Codama fixture and the "A Codama IDL is read" scenario
  (ticket to file; after 4.1)

## 6. Integration

- [ ] 6.1 Walk the whole flow on Devnet with a fresh Anchor project: build,
  deploy, upload the IDL, read it back by program id, simulate and send one
  instruction; record the result in the PR (ticket to file; after 2.4, 3.5
  and 4.2)
