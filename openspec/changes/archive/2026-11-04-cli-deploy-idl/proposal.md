# Proposal

## Why

The "Deploy from your machine" dialog hands over the program binary and the
command that deploys it, but nothing for the IDL. A program deployed that way
shows unnamed instructions in Explorer until someone uploads its IDL by hand.
Sergey asked for it on the demo-build review call of 30 Oct and settled the
tool on 3 Nov (spike HOO-2486): the Program Metadata CLI,
`npx @solana-program/program-metadata@latest write idl ...`, on every cluster.
Ticket: HOO-2487.

## What Changes

- Step 1 of the dialog gets "Download IDL" beside "Download .so". It saves the
  IDL Playground holds as `<program>.json`, the file the scripts name; with no
  IDL it is off. It shows without a build too, since an IDL can be loaded.
- A step "3.1 Upload the IDL" under step 3 gives the Program Metadata command
  for both tools and both clusters, with the program id filled in, or
  `<program-id>` when the project has none.
- With Anchor picked, a second command below it: `anchor idl init`, the
  legacy Anchor IDL account before Anchor 1.0 (1.0 and later write to Program
  Metadata themselves).
- `cli_command_copied` says which command was copied (`step: "deploy" |
  "idl"`), and a new `cli_idl_downloaded` event counts IDL downloads.

## Impact

- `client-v2/src/features/cli-deploy/` only: `model/commands.ts`,
  `model/telemetry.ts`, `ui/BaseCliDeployGuide.tsx`, `ui/CliDeployGuide.tsx`,
  `ui/DownloadProgram.tsx` (shares `useIdl` and `saveFile`), new
  `ui/BaseDownloadIdl.tsx`, `ui/DownloadIdl.tsx` and `lib/save-file.ts`.
- Spec `cli-deploy`: the guide requirement and the events requirement change.
