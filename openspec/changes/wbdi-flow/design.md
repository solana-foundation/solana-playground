# Design

## Context

See [proposal.md](proposal.md), "Why". What client-v2 does in each step, read
at `dc22a4740`:

- **Build**: `commands/build/build.ts` writes the program keypair's public key
  into `declare_id!` and posts the source to the build server
  (`utils/server.ts`). The server returns `{ stderr, uuid, idl }`, keeps the
  binary and serves it to the deploy from `/deploy/{uuid}`.
  `utils/program-info.ts` keeps the IDL, the keypair and the uuid in
  `.workspace/program-info.json`, which project sync carries to other
  devices. Anchor is pinned to 0.29.
- **Deploy**: `commands/deploy/` runs the BPF Upgradeable Loader steps in the
  browser. The playground wallet (`utils/wallet/wallet.ts`, a keypair in
  localStorage) pays and signs. An extension wallet first transfers the cost
  to the playground wallet. Nothing warns before Mainnet Beta.
- **IDL**: nothing writes an IDL on chain from the UI. "Upload IDL" in
  `views/flow/stages/IdlActions.tsx` replaces the IDL in the browser only.
  `effects/fetch-idl/fetch-idl.ts` reads the Anchor IDL account, and only for
  the project's own deployed program.
- **Interact**: `views/flow/stages/Interact.tsx` embeds the upstream test form
  (`views/sidebar/test/`) over `utils/program-interaction/`. Accounts with a
  `pda` field get a From seed generator, and `pda.programId` is ignored.
- **Export**: `PgFramework.exportWorkspace` (`utils/framework.ts`) zips the
  framework layout with `target/deploy/<name>-keypair.json` and a README of
  `anchor build` and `anchor test`.

Solana Explorer's Interactive IDL (`app/features/idl/interactive-idl/` in
solana-explorer) is the reference for Interact. It reads Codama and Anchor
0.30+ only, takes the IDL from chain only (Program Metadata first, the Anchor
IDL account as a fallback), derives PDAs from IDL seeds, simulates before an
execute by default, and confirms the first execute on mainnet.

## Goals / Non-Goals

**Goals:**

- Every function in the four specs exists in client-v2, and the existing ones
  keep working while the gaps are filled.
- The flow on the playground matches the flow on a developer's machine:
  `anchor build`, `solana program deploy`, an IDL upload, a client call.

**Non-Goals:**

- Replacing the upstream test form in one step. It moves by the UI move rule
  in `client-v2/CLAUDE.md`, one part at a time.
- Changing the build server's API.

## Decisions

### Two outputs, one cluster per upload

A build produces a binary and an IDL from the same source. A deploy puts each
on one cluster, in separate transactions: first the binary, then the IDL. The
specs therefore track deploy and IDL state per cluster: a program on Devnet is
not on Mainnet Beta until it is uploaded there. This mirrors how Solana itself
works, and keeps the user from reading a Devnet IDL as proof of a mainnet
program.

```mermaid
flowchart LR
  src["Program source<br/>(Anchor, Native, Seahorse)"] --> build["Build<br/>(build server)"]
  build --> bin["Program binary"]
  build --> idl["IDL<br/>(Anchor and Seahorse only)"]
  bin --> deploy["Deploy or upgrade<br/>(BPF Upgradeable Loader)"]
  deploy --> cluster[("Selected cluster<br/>Playnet, Localnet, Devnet,<br/>Testnet, Mainnet Beta, custom")]
  idl --> upload["IDL upload"]
  upload --> pmp[("Program Metadata<br/>(default)")]
  upload --> anchoridl[("Anchor IDL account<br/>(legacy)")]
  pmp --> cluster
  anchoridl --> cluster
  cluster --> interact["Interact<br/>(simulate, send, logs)"]
  bin -. export .-> scripts["Local deploy scripts<br/>(user's Solana CLI)"]
  idl -. export .-> scripts
  scripts -.-> cluster
```

### Program Metadata is the default IDL source, the Anchor IDL account is legacy

Both store an IDL for a program id, and the Explorer shows both. Program
Metadata is the program the ecosystem is moving to and the one the Explorer
reads first, so the playground uploads there by default and reads it first.
The Anchor IDL account stays available both for reading and for upload,
because programs deployed with older Anchor tooling publish only there.
Alternative considered: Anchor IDL account only, as `anchor idl init` does at
0.29. Rejected: an IDL there is not what the Explorer reads first, so a user
could publish and still see a stale IDL.

### A local IDL is a first-class source

A program may be deployed with no IDL published, often because other people
maintain it. The playground does not build an IDL for such a program. Instead
the user supplies one: a file, or JSON pasted or typed into an editor. Both
paths give the same result. A local IDL is also how the user tries an edited
copy of a published IDL. Loading one never writes to the chain.

```mermaid
flowchart TD
  pid["Program id on the selected cluster"] --> read["Read the IDL from chain"]
  read --> found{"Program Metadata or<br/>Anchor IDL account<br/>has an IDL?"}
  found -- "yes: each source that has one" --> picker["Source picker<br/>(idl-source)"]
  found -- "neither has one" --> none["No IDL on chain:<br/>offer a local IDL"]
  build["The project's build IDL"] --> picker
  file["File"] --> local["Local IDL"]
  paste["Pasted JSON<br/>(idl-paste)"] --> local
  local --> picker
  none --> local
  picker -->|"default order: Program Metadata,<br/>Anchor IDL account, build;<br/>a loaded local IDL is selected"| form["Interact form"]
```

### The playground does not deploy to mainnet

The playground wallet is a keypair in localStorage. Funding it for a mainnet
deploy means sending real SOL to a key any script on the page can read. The
playground cannot make that safe, so it does not deploy to Mainnet Beta and
sends the user to the alternative: the same program, with the same program
id, deployed from the user's machine with the scripts in the export.

The block sits in front of the deploy itself, not in front of one button, so
the terminal `deploy` command and the assistant's tools reach it too. An
extension wallet does not lift it, because a deploy with an extension still
moves the cost into the playground wallet, which signs the loader
transactions. IDL uploads are blocked the same way; the IDL upload script
covers them. Sending an instruction from Interact stays allowed on Mainnet
Beta: it calls a program, it does not deploy one.

The terminal is a second way in. The WASM `solana` CLI already lacks
`program deploy` and `write-buffer` (commented out in
`wasm/solana-cli/src/commands/program.rs`), but `program close` and
`set-upgrade-authority` are live, and the WASM `anchor` CLI writes the Anchor
IDL account with `idl init`, `upgrade` and the rest (`process_idl` in
`wasm/anchor-cli/src/commands/idl.rs`). `solana` also takes `-u` on every
command, so the selected cluster is not the cluster a command reaches. The
refusal therefore lives in the `commands/solana` and `commands/anchor`
wrappers and checks the cluster each command resolves to. `close` and
`set-upgrade-authority` deploy nothing, but on mainnet they destroy a program
or hand it to another key with the browser key, so they are refused too.

```mermaid
sequenceDiagram
  actor User
  participant Start as Deploy button, terminal or assistant
  participant Guard as Mainnet guard (mainnet-guard)
  participant Chain as Mainnet Beta
  alt Program deploy
    Start->>Guard: deploy on Mainnet Beta (deploy_started)
  else IDL upload
    Start->>Guard: IDL upload on Mainnet Beta (idl_upload_started)
  end
  Note over Guard,Chain: nothing is ever sent to Mainnet Beta
  alt Download deploy scripts
    User->>Guard: Download deploy scripts (mainnet-guard-scripts)
    Guard-->>User: export with scripts (deploy_mainnet_warned: scripts)
    User->>Chain: deploy from the user's machine with the Solana CLI
  else Close
    User->>Guard: Close
    Guard-->>Start: nothing sent (deploy_mainnet_warned: close)
  end
```

Alternatives considered:

- A disclaimer with an "I understand the risk" checkbox, shown on every
  mainnet deploy, with the acceptance recorded in a cookie. Rejected: a key
  stored in the browser is not made safe by a dialog, and a cookie proves
  nothing about who accepted. With deploys blocked, there is no acceptance to
  record.
- Allow mainnet with an extension wallet only. Rejected while the extension
  only funds the playground wallet.

Mainnet deploys from the playground may be enabled in a later change, once
the wallet interaction is secured: the user's own wallet signs every deploy
and IDL transaction end to end, and no key that pays for or signs a mainnet
transaction is stored in the browser. Until then the guard and the terminal
refusals stay, and enabling mainnet means a change that replaces the
requirements "The playground never deploys to Mainnet Beta" and "The
terminal sends no program transaction to Mainnet Beta".

The Interact confirmation on the first mainnet send per session follows the
Explorer's behaviour; it was chosen while writing this change, not requested. It is per
session rather than the Explorer's 182-day cookie, because the playground
wallet raises the stakes.

### Local deploy scripts live in the export

The export already carries the framework layout and the program keypair, so
it is the one place a user downloads to work locally. The scripts call the
Solana CLI and the Program Metadata CLI the user installs, with the cluster
and the payer keypair path as arguments, so no secret leaves the browser in
the zip except the program keypair, which is already there. Shell scripts were
chosen while writing this change; the request was only for scripts that
deploy the program and upload the IDL.

### Interact reads every format the playground reads

The Explorer gives no Interact form to an Anchor IDL older than 0.30. The
playground does, because its projects are built at Anchor 0.29 and the
upstream form handles that format today. Codama and Anchor 0.30+ are added
next to it. Automatic PDA derivation for 0.30+ seeds and for Codama
`pdaValueNode`s needs the Anchor 0.29 to 1.1.2 migration for projects built in
the playground; for a program read from the chain it does not.

### From seed stays

The Explorer derives PDAs from IDL seeds and has no manual builder. The
playground keeps From seed because many IDLs give no seeds, older Anchor IDLs
among them, and a user exploring someone else's program needs to build an
address by hand.

### Slices and telemetry

New code goes in four feature slices with their own prefixes: `program-build`
(`build`), `program-deploy` (`deploy`), `program-idl` (`idl`) and
`program-interact` (`interact`). A feature never imports another, so the
Flow stages, a widget, join them. The legacy `commands/build` and
`commands/deploy` stay where they are (the UI move rule keeps
`src/commands/` in place); the slices call them and emit the events. Events
carry no program id, address or signature, as `client-v2-telemetry` in
`telemetry-and-logging` requires, which is why they differ from the
Explorer's `iidl_*` events that carry `program_id`.

Every action control emits its own event, and an action that takes time also
emits an outcome event: `interact_send_started` on the click, `interact_sent`
or `interact_failed` on the result. With both, a funnel tells a user who never
clicked Send from one whose send failed, and a dialog's Cancel shows where a
user turned back. Instruction names stay out of the events because they come
from the user's IDL.

## Risks / Trade-offs

- [The Program Metadata program or its client changes format] → read and
  write through one client package, pinned, so a format change is one bump.
- [A path reaches Mainnet Beta around the guard] → the guard sits in front
  of the deploy itself, the terminal wrappers check the resolved cluster, and
  scenarios cover the button, the assistant, `anchor idl` and a `-u` flag.
- [A later WASM CLI build enables `solana program deploy`] → the "Solana
  program deploy is unavailable" scenario fails, so the change cannot land
  silently.
- [A user who wants mainnet finds the playground less convenient] → the guard
  offers the scripts in one click, and they keep the program id.
- [Two on-chain IDLs disagree] → the source picker shows which one is in use,
  and the default is the one the Explorer reads first.
- [The Anchor migration slips] → the 0.30+ and Codama tasks for projects built
  in the playground wait for it; reading such IDLs from chain does not.
- [Localnet needs a validator the playground does not start] → the Localnet
  scenario names `localhost:8899`; the export README says how to start
  `solana-test-validator`.

## Open Questions

- The exact name and version of the Program Metadata client package, settled
  by the IDL upload task.
