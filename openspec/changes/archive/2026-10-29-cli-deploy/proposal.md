# Proposal

## Why

The mainnet warning tells users to deploy a program that matters from their
own machine with the Solana CLI or Anchor, but Playground gives them neither
the binary it built nor the commands to do it. Legacy Playground's "import a
program binary" setting is not coming back, so downloading the `.so` and
deploying it locally is the supported way out of the browser wallet
(HOO-2404, part of the parity set HOO-2395).

## What Changes

- The Build stage, after a successful build, offers "Download .so" beside
  "Download IDL". It fetches the binary from the build server on click and
  saves it as `<program>.so`; nothing is kept in the client. When the server
  no longer holds the build, it says "Build again to download the binary".
- A "Deploy from your machine" dialog gives the Solana CLI and Anchor
  commands for devnet and mainnet, each copyable, with the program's file
  names filled in and a note on the program keypair. It opens from the
  mainnet warning and from the Deploy stage, and offers the binary download
  itself.
- The build server client keeps the HTTP status of a failed request, so a
  missing build is told apart from any other server failure.
- New slice `features/cli-deploy` with telemetry prefix `cli`. Events added:
  `cli_binary_downloaded`, `cli_binary_download_failed`, `cli_guide_opened`,
  `cli_command_copied`. No event is renamed or removed.

## Capabilities

### New Capabilities

- `cli-deploy`: taking the built program out of Playground and deploying it
  from the user's own machine: the binary download and the CLI deploy guide.

### Modified Capabilities

- `mainnet-deploy-warning`: the warning offers the CLI deploy guide it
  recommends.

## Impact

- `client-v2/src/features/cli-deploy/` (new), `views/flow/stages/Build.tsx`,
  `BaseDeploy.tsx`, `Deploy.tsx`, `utils/server.ts`,
  `shared/lib/telemetry/prefixes.ts`.
- No server change: the existing `/deploy/<uuid>` route serves the binary.
- Out of scope: importing a `.so` into Playground; deploying from the guide
  on the user's behalf; exporting the program keypair (HOO-2397 adds it to
  the Deploy stage; until then the guide names the keypair file without a
  button to save it); a design pass on the dialog, which goes to design
  review after merge.
