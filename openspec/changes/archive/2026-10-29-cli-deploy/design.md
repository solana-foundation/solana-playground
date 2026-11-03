# Design

## Context

`PgServer.deploy(uuid)` (`utils/server.ts`) already fetches `/deploy/<uuid>`
and returns the program bytes the `deploy` command writes to its buffer.
`PgServer._send` turns every non-OK answer into a plain `Error` carrying the
body text, so the status is lost. The public server answers a build it no
longer holds with **500** and the body `Program is not built` (probed
2026-10-29: `curl https://api.solpg.io/deploy/<random uuid>`), not with 404
as HOO-2404's text assumed; the unstable route on the public host is a plain
nginx 404 because it is not deployed there.

The Build stage renders `IdlActions mode="download"` in the success surface
through `BaseBuild`'s `idlActions` slot. The Deploy stage (`BaseDeploy`)
shows the mainnet callout and one brand action. HOO-2385 (deploy Spec 03) is
reworking the Deploy stage in parallel, so this change touches it only to add
the two triggers.

No design source draws either control: the DS prototype, Almaz's stand and
the designers' specs (`03-deploy-and-interact`, `07-settings`: "Program ID,
program binary and IDL actions stay in the Build and Deploy panel") say
nothing more. The decisions below are ours and go to the designers' batch.

## Goals / Non-Goals

**Goals:** the binary leaves Playground in one press; the guide's commands
run as shown.

**Non-Goals:** exporting the program keypair (HOO-2397); Playground deploying
on the user's behalf; caching the binary.

## Decisions

- **A feature slice, `features/cli-deploy`.** Two user actions (download the
  binary, read the guide) with their own state and events. `ui/` holds the
  `BaseDownloadProgram`/`DownloadProgram` and `BaseCliDeployGuide`/
  `CliDeployGuide` pairs; `model/` holds the command builder, the program
  name and the failure classifier. The legacy stages import it through
  `index.ts`. The alternative, adding to `IdlActions` in `views/`, puts new
  UI in a legacy root, which `client-v2/CLAUDE.md` forbids.
- **Keep the status: `PgServerError`.** `_send` throws an error that carries
  `status` and the body. `downloadFailure` maps 500 with
  `Program is not built` to `not-built`, everything else to `server`; a 404
  is not read as "not built", because on the public host it means the route
  is missing and a rebuild would not help.
- **Fetch on click, save through a blob URL.** `PgServer.deploy` → `Blob` →
  `URL.createObjectURL` → a temporary `<a download>` → revoke. Nothing is
  stored; a second press fetches again.
- **Program name** from IDL `metadata.name` (Anchor ≥ 0.30), else IDL
  `name`, else the workspace name in snake_case, else `program`. Anchor names
  both files after the lib name, which is what the IDL carries.
- **The guide is a dialog**, not a docs page: the commands need the
  program's name and id, which only the app knows. Two `Segmented` controls
  (Tool, Cluster), `CodeBlock` with `CopyButton` per command, the download
  button inline. Anchor's path copies the files into `target/deploy/`,
  because `anchor deploy` deploys whatever is there under the lib name.
- **Triggers.** Mainnet callout: the body's own words "deploy from your own
  machine" become a `link` button opening on Mainnet (Spec 03 keeps that
  copy, still open with design, so no words are added). Deploy stage: a ghost "Deploy with the
  CLI" beside the brand action, opening on the current cluster. Distinct
  labels, because on mainnet both show at once.
- **`BaseDeploy` gains one prop**, `onOpenCliGuide(from)`; `Deploy` owns the
  dialog's open state, keeping the shared stage file's diff small against
  HOO-2385.

## Risks / Trade-offs

- [The server may change its "not built" body] → the classifier is one
  predicate with a test; a change shows the generic toast, never a wrong
  rebuild hint.
- [The guide names a keypair file the user cannot yet export] → the note
  says what the keypair does; HOO-2397 adds the export and can link it.
- [Large binaries] → a blob in memory only for the moment of the save.
