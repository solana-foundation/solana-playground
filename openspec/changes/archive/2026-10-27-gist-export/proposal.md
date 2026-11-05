# Proposal

## Why

A signed-in user has no way to hand a project to someone else: "Export as zip"
makes a file they have to send by hand, and the account sync keeps projects
private. HOO-1760 moves sharing onto the user's own GitHub: the project becomes
a public gist and the user gets its URL. HOO-1761 (open a project from a gist
URL) is the other half and reverses this export, so the way a project's tree is
flattened into a gist is settled here, once, for both.

## What Changes

- A project's menu in the navigation gains **Share as gist** (key `G`). It opens
  a dialog that says the gist will be public, creates it on the user's GitHub
  account, and shows the gist URL with Copy and Open buttons.
- Signed out, the dialog's action signs the user in first. A session whose
  GitHub token lacks the `gist` scope is asked, once, to allow gists on GitHub
  (a popup, as sign-in already is); then the export retries by itself.
- Sign-in itself keeps requesting no more than it does today (`read:user
  user:email`): only a user who shares sees the wider consent screen, and no
  existing session has to re-authorise before using the rest of the app.
- A new `POST /api/gists` route creates the gist with the user's stored GitHub
  token. The token never reaches the browser.
- A gist format, version 1: every exportable file under a flat, readable name,
  plus a manifest `.playground.json` that maps each gist file back to its path
  and lists the empty files a gist cannot hold. `.workspace/` (whose
  `program-info.json` holds the program keypair) and `.tutorial.json` are never
  exported.
- A new feature slice `features/gist` shared with HOO-1761: this change lands
  the format (`toGistFiles`, `fromGistFiles`, `isExportablePath`) and the
  export; HOO-1761 adds URL parsing and the import into the same slice.
- Telemetry, prefix `gist` (new): `gist_export_started`,
  `gist_export_scope_requested`, `gist_export_succeeded`,
  `gist_export_failed`. `app-nav` gains the `share-gist` value of its
  existing `ProjectAction` in `nav_project_action` and
  `nav_project_action_failed`; it adds no event.

## Capabilities

### New Capabilities

- `gist-sharing`: putting a project on GitHub as a public gist and the format
  that lets it be opened again. HOO-1761 adds its import requirements to the
  same capability.

### Modified Capabilities

None.

## Impact

- Code: new `client-v2/src/features/gist/` (lib, model, ui, server.mjs), new
  `client-v2/api/gists.mjs` and its `node --test` file, `widgets/app-nav`
  (menu item, action, wiring the sign-in callbacks), `features/auth`
  (`PgSession.signIn` takes extra scopes), `shared/lib/telemetry/prefixes.ts`.
- External API: GitHub `POST /gists` with the user's OAuth token.
- No database change and no migration: Better Auth already stores the GitHub
  access token on the `account` row.
- Out of scope: opening a gist (HOO-1761); remembering a project's gist and
  updating it on the next share (HOO-1762; until then each share makes a new
  gist); removing the old server share routes (HOO-1764); secret gists; sharing a
  project's program keypair or deployed address; binary files (the workspace
  holds none).
