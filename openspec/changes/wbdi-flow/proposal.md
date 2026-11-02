# Proposal

## Why

The playground exists to take a Solana program from source to a working
program on chain: write, build, deploy, interact (WBDI). Today client-v2 does
each step only part of the way, and no spec says what the full flow must do.
The IDL never reaches the chain, a mainnet deploy spends real SOL from a key
kept in the browser without a warning, and Interact works only for the
user's own build. This change records every function the WBDI flow must have,
the existing ones included, so that later work keeps them and fills the gaps.

## What Changes

The flow has two outputs and three destinations. A build turns the source into
a program binary and an IDL. A deploy uploads both to one cluster. Interact
calls the deployed program through an IDL.

Functions client-v2 has, recorded so they are kept:

- Build of an Anchor, Native or Seahorse project on the build server, returning
  the binary for deploy and the IDL, both kept with the project.
- Deploy and upgrade through the BPF Upgradeable Loader, with pause, resume,
  cancel, and closing the buffer after a cancel.
- A choice of cluster: Playnet, Localnet, Devnet, Testnet, Mainnet Beta, and a
  custom RPC URL.
- Interact with an instruction form, automatic PDA derivation from the IDL's
  `pda` seeds, the manual "From seed" builder, wallet autofill for signers,
  and an IDL loaded from a file.
- Export of the project as a zip in the framework's own layout, with the
  program keypair.

Functions to add:

- **IDL upload on chain**, to the Program Metadata program by default and to
  the Anchor IDL account as the legacy option, on the cluster the program was
  deployed to.
- **No mainnet deploy from the playground**: a deploy or IDL upload started
  on Mainnet Beta, by the button, the terminal or the assistant and with any
  wallet, sends nothing. A mainnet guard explains why and sends the user to
  the local deploy scripts, to deploy from their own machine. The terminal's
  `solana program` and `anchor idl` commands that write to chain refuse on
  Mainnet Beta too, whatever `-u` flag they carry.
- **Local deploy scripts** in the export: one deploys the program binary, one
  uploads the IDL, both run with the user's own Solana CLI and keypair.
- **Interact with any program**: the user enters a program id, the playground
  reads the IDL from the Program Metadata program and the Anchor IDL account,
  and the user picks one when both exist. A local IDL can be uploaded as a file
  or pasted as JSON, for a program with no IDL on chain or to try an edited
  one.
- **Simulate before send** in Interact, on by default, with logs and the
  result shown for both.
- **Modern IDL formats**: Anchor 0.30+ and Codama IDLs drive the Interact form.
  These depend on the Anchor 0.29 to 1.1.2 migration.
- **Program id controls**: import, export and replace the program keypair from
  the UI, so the same program id can be deployed from the playground and from
  the user's machine.

Telemetry: every control on the four screens that performs an action emits
its own event, so a user's path through the flow can be rebuilt. Events added
(the specs give the parameters); none is renamed or removed:

- Build: `build_started`, `build_succeeded`, `build_failed`,
  `build_idl_downloaded`, `build_project_exported`, `build_fix_requested`.
- Deploy: `deploy_started`, `deploy_succeeded`, `deploy_failed`,
  `deploy_paused`, `deploy_resumed`, `deploy_cancelled`,
  `deploy_buffer_close_answered`, `deploy_stale_warned`,
  `deploy_airdrop_requested`, `deploy_program_id_copied`,
  `deploy_keypair_exported`, `deploy_keypair_import_started`,
  `deploy_keypair_imported`,
  `deploy_keypair_created`, `deploy_keypair_replace_warned`,
  `deploy_mainnet_warned`, `deploy_scripts_exported`.
- IDL: `idl_loaded`, `idl_load_failed`, `idl_uploaded`, `idl_upload_failed`,
  `idl_source_selected`, `idl_file_picker_opened`, `idl_paste_opened`,
  `idl_local_cleared`, `idl_target_selected`, `idl_upload_started`.
- Interact: `interact_simulated`, `interact_sent`, `interact_failed`,
  `interact_simulate_started`, `interact_send_started`,
  `interact_simulate_toggled`, `interact_mainnet_confirmed`,
  `interact_program_opened`, `interact_instruction_opened`,
  `interact_random_filled`, `interact_seed_opened`,
  `interact_seed_generated`, `interact_explorer_opened`,
  `interact_logs_copied`, `interact_empty_action`.

Choosing a cluster is not among them: that control belongs to the layout and
settings slices, which own its events.

## Capabilities

### New Capabilities

- `client-v2-program-build`: what a build takes, what it produces, and where
  the binary and the IDL are kept.
- `client-v2-program-deploy`: deploying and upgrading a program on a cluster,
  who pays, the mainnet guard, the terminal's mainnet refusals, and the local
  deploy scripts.
- `client-v2-program-idl`: the IDL formats the playground reads, where an IDL
  comes from, choosing between sources, and uploading an IDL on chain.
- `client-v2-program-interact`: calling a deployed program's instructions,
  filling accounts and arguments, simulating, sending, and showing the result.

### Modified Capabilities

None. `client-v2-stages` in `ui-migration` describes how the Build, Deploy and
Interact stages look; this change describes what they do, and the two do not
overlap.

## Impact

- Code in client-v2 only: `commands/build`, `commands/deploy`,
  `utils/program-info.ts`, `utils/program-interaction`, `effects/fetch-idl`,
  `views/flow/stages`, `views/sidebar/test`, `frameworks/*/export.*`,
  `commands/solana`, `commands/anchor`, and new slices under `features/` for
  IDL sources, IDL upload and the mainnet guard.
- New dependencies: a client for the Program Metadata program, and Codama for
  reading Codama IDLs. The user sees IDLs that other tools published.
- Depends on the Anchor 0.29 to 1.1.2 migration for the Anchor 0.30+ IDL
  format and for building projects newer than Anchor 0.29.

Out of scope:

- New frameworks. Pinocchio and others need the build server to accept their
  crates; `server/` is not modified. A framework is added by its own change.
- Building an IDL for a program the user did not write.
- Signing a deploy with an extension wallet end to end. The extension funds the
  playground wallet, as it does today. Securing that wallet interaction is what
  a later change needs before it can enable mainnet deploys from the
  playground.
- Running a local validator from the browser. Localnet means a validator the
  user runs on their machine; Playnet stays the in-browser one.
- Verified builds and publishing the source for verification.
- The `sugar` terminal command. It can create Candy Machine accounts on
  Mainnet Beta with the playground key, but it deploys no program, and this
  change leaves it as it is.
