# Proposal

## Why

Sharing moves to the user's own GitHub: HOO-1760 exports a project to a
public gist and hands back its URL. That URL is only useful if the person
who receives it can open the project from it, and that person is usually
signed out. Playground opens a repository URL today, but not a gist.

## What Changes

- A gist URL opens as a project, signed in or not, in two places:
  - the import dialog ("From GitHub" in Settings and in the explorer), which
    imports it as a saved project;
  - a link, `/gist/<id>` or the playground URL followed by the gist URL
    (as `/{githubUrl}` works for repositories), which opens it as a view
    the user can look at without saving.
- The gist is read from GitHub's public gist API without an account. A file
  the API cuts short is downloaded whole; a gist too large for the API to list
  fully is refused with a message saying so. A missing or private gist and
  GitHub's hourly limit each get their own message.
- Files land as `gist-sharing`'s format says (HOO-1760): at the paths a
  Playground manifest names, or by kind for a gist made by hand. A gist no
  framework recognises is refused as having no program.
- An imported gist becomes a project named `gist-<owner>/<id>`; importing the
  same gist again opens that project, as importing a repository twice does.
- Importing from a link's unsaved view works: before, creating a project
  from a repository link's view failed with "Workspace not found", because
  the view keeps no project list in memory. Repository import gets the fix
  too.
- The gist code lives in one `features/gist` slice shared with HOO-1760:
  this change adds its URL parsing and the import; the format module, the
  slice and its `gist` prefix are HOO-1760's.
- Events added (`features/gist`, prefix `gist`): `gist_import_started`,
  `gist_import_succeeded`, `gist_import_failed`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `gist-sharing` (introduced by the change `gist-export`, HOO-1760): adds
  opening a project from a gist URL, in the import dialog and from a link,
  with its error messages and telemetry. The format, the manifest checks and
  the placement of a hand-made gist's files are that change's requirements
  and are not repeated here.

## Impact

- Code: in `client-v2/src/features/gist/` (HOO-1760's slice), new
  `lib/url.ts` and `model/import.ts` and lines added to `model/telemetry.ts`
  and `index.ts`; a new route folder
  `client-v2/src/routes/gist/`, the import dialog
  `views/sidebar/explorer/Component/Modals/ImportGithub.tsx` (label,
  placeholder, validator).
- External: `api.github.com/gists` (unauthenticated, 60 requests an hour per
  browser, shared with repository import) and `gist.githubusercontent.com`
  for files the API truncates. No server change.
- Out of scope: exporting to a gist and the gist format itself (HOO-1760);
  updating a gist on re-export (HOO-1762); projects with no program, such as
  a gist of plain TypeScript (HOO-2147: such a gist is refused as a
  repository with no program is today); the server's share routes and old
  share links (HOO-1764); a "save this view" action for the link form, which repository links lack
  too.
