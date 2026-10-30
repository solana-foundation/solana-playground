# Tasks

Groups 1 to 4 can start in parallel. Within a group, tasks run in order unless
a task says otherwise. Every task is one PR, and every slice task declares,
describes and emits its spec's events with memory-provider tests.

## 1. Build

- [ ] 1.1 Create the `program-build` slice with the `build` prefix, emit
  `build_started`, `build_succeeded` and `build_failed` around
  `commands/build`, and verify with memory-provider tests for each
  `framework` and `reason` (ticket to file)
- [ ] 1.2 Cover the existing build requirements with e2e specs titled
  `client-v2-program-build: <scenario>`, the build server stubbed with
  `page.route`, and verify they pass on the code as it is (ticket to file;
  after 1.1)

## 2. Deploy

- [ ] 2.1 Create the `program-deploy` slice with the `deploy` prefix and emit
  `deploy_started`, `deploy_succeeded` and `deploy_failed`; verify with
  memory-provider tests per `phase` (ticket to file)
- [ ] 2.2 Track deploy state per cluster so a program on Devnet shows as not
  deployed on Testnet; verify with the "Devnet deploy is not on testnet"
  scenario (ticket to file; after 2.1)
- [ ] 2.3 Put the mainnet disclaimer dialog (`mainnet-guard`) in front of
  every Mainnet Beta deploy, whichever wallet pays and whether the button,
  the terminal `deploy` command or the assistant starts it, shown every time
  with the unticked "I understand the risk" checkbox
  (`mainnet-guard-accept`) gating Deploy to mainnet (`mainnet-guard-deploy`),
  writing `pg_mainnet_disclaimer` on acceptance and emitting
  `deploy_mainnet_warned` and `deploy_mainnet_accept_toggled`; verify with
  the disclaimer and cookie scenarios (ticket to file; after 2.1)
- [ ] 2.4 Add the deploy script, the IDL upload script and the README steps to
  the export of every framework, and wire Download deploy scripts in the
  disclaimer with `deploy_scripts_exported`; verify by running both scripts
  against `solana-test-validator` and with the export scenarios (ticket to
  file; after 2.3)
- [ ] 2.5 Add program keypair export, import and create to the Deploy stage,
  with the warning before replacing a deployed program's keypair; verify with
  the "Import a keypair" scenario (ticket to file; after 2.1)

## 3. IDL

- [ ] 3.1 Create the `program-idl` slice with the `idl` prefix, recognising
  Anchor before 0.30, Anchor 0.30+ and Codama, refusing anything else with a
  reason; verify with unit tests on fixtures of each format and
  `idl_load_failed { reason: "invalid" }` (ticket to file)
- [ ] 3.2 Read the IDL from the Program Metadata program and the Anchor IDL
  account for any program id on the selected cluster; verify with the "A
  program with no IDL on chain" scenario and `idl_loaded` per `source`
  (ticket to file; after 3.1)
- [ ] 3.3 Add the IDL source picker (`idl-source`) with the default order and
  the legacy mark; verify with the "Both on-chain IDLs exist" scenario
  (ticket to file; after 3.2)
- [ ] 3.4 Add the paste editor (`idl-paste`) beside the file picker, both
  giving the same local IDL; verify with the "Paste an edited IDL" scenario
  (ticket to file; after 3.1)
- [ ] 3.5 Upload the project's IDL to the Program Metadata program, and to
  the Anchor IDL account as the legacy option, on the deployed cluster with
  the authority check, and behind the mainnet disclaimer on Mainnet Beta; verify on
  Devnet with the upload scenarios and `idl_uploaded` (ticket to file; after
  3.2 and 2.3)

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

These tasks wait for the Anchor 0.29 to 1.1.2 migration (ticket to file).

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
