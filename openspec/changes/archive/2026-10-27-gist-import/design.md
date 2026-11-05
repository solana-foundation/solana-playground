# Design

## Context

Repository import (`utils/github.ts`, `PgGithub`) reads a Git tree, downloads
the program's files and turns them into Playground's layout with
`PgFramework.convertToPlaygroundLayout`. It is reached from the import dialog
(`ImportGithub`), from catalog cards (`program-open.ts`) and from the route
`/{githubUrl}`, which opens the files as a temporary explorer
(`PgExplorer.init({ files })`) without saving them.

A gist is flat: its file names cannot hold `/`. HOO-1760, built in parallel,
defines how a project is flattened into a gist and how that is reversed
(`features/gist/lib/format.ts`: `toGistFiles`, `fromGistFiles`,
`isExportablePath`, `GistFormatError`, manifest `.playground.json`). This
change consumes `fromGistFiles` and owns everything between a URL and a
project.

## Goals / Non-Goals

**Goals:**

- One import path for the dialog and the route, with the same messages and
  the same events.
- No GitHub account, no server: the receiver of a shared link is usually
  signed out.

**Non-Goals:**

- The format and its tests (HOO-1760).
- Turning a temporary gist view into a saved project; the repository view
  lacks it too.

## Decisions

- **One slice, `features/gist`, for export and import.** Both sides must
  agree on the format, and a feature never imports another feature, so a
  separate `gist-import` slice could not read HOO-1760's format module.
  The alternative, the format in `shared/lib`, would put Playground's
  layout rules (which paths are exportable) in a layer meant to carry no
  domain knowledge. Ownership inside the slice: `lib/url.ts` and
  `model/import.ts` here, `lib/format.ts` and the export model in HOO-1760;
  `model/telemetry.ts` and `index.ts` take lines from both.
- **The gist API, not the raw URLs.** `GET api.github.com/gists/<id>[/<sha>]`
  answers with every file's name and content in one request and allows any
  origin (probed 2026-10-26: `access-control-allow-origin: *`). Content over
  1 MB comes back marked `truncated`; only those files are fetched from their
  `raw_url` on `gist.githubusercontent.com`, which is outside the API's
  hourly limit. A gist whose file list is itself `truncated` (over 300
  files) is refused rather than imported partly.
- **Errors are modelled on repository import's** (403/429 with no requests
  remaining, 404, other status), so the two imports read alike. A missing
  gist "may have been deleted" rather than "may be private": a secret gist is
  readable by anyone with its URL.
- **Layout comes from `fromGistFiles`, then the framework check.** A
  manifest gives exact Playground paths; the loose rules give `src/`,
  `tests/` and `client/`. Both are already Playground's layout, so the
  files are not run through `convertToPlaygroundLayout` (which expects a
  framework's layout and drops a bare `lib.rs`). A gist no framework
  recognises (`PgFramework.getFromFiles`) is refused as "no program" until
  HOO-2147 lifts that for repositories and gists alike.
- **The route is a new folder, `routes/gist`,** holding `/gist/{ref}`
  (`<id>` or `<id>/<revision>`) and the
  path-prefix form validated by the URL parser, mirroring `routes/github`.
  `/gist/<id>` is the short form a share message can carry.
- **A link's view can be saved through the dialog.** The explorer's
  temporary view drops its project list; `createWorkspace` now reads it back
  from the store first, and `PgExplorer.getAllWorkspaceNames` gives both
  imports the names to check for a copy imported before.
- **Project name `gist-<owner>/<id>`,** like `github-<owner>/<repo>/<path>`,
  so importing the same gist twice opens the first copy. A revision in the
  URL is part of the name (`gist-<owner>/<id>@<revision>`), so a pinned
  revision never opens over the latest one.
- **Events** are sent by `model/import.ts`, so the dialog and the route
  cannot drift; `from` is passed by the caller.

## Risks / Trade-offs

- [The format is HOO-1760's] → this change stacks on its PR; the import's
  tests stand the format in with `vi.mock` and the e2e runs the real one.
- [Re-import opens a stale copy after the owner re-exports (HOO-1762)] →
  same as repositories today; see Open Questions.
- [60 requests an hour, shared with repository import] → one request per
  import plus one per truncated file; the limit message says when to retry.

## Open Questions

- Should importing a gist that was re-exported since refresh the existing
  project instead of opening the old copy? Deferrable: it changes one branch
  of `model/import.ts`, not the spec's shape.
