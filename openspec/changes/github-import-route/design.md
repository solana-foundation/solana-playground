# Design

## Context

The router (`PgRouter`, `client-v2/src/utils/router.ts`) matches `{param}`
templates; a parameter at the end of a template takes the rest of the path,
slashes included. Two routes served GitHub: `/{githubUrl}`, validated by
`PgGithub.isValidUrl`, which loaded the repository, and `/github/{url}`,
which forwarded a full GitHub URL to the first. `PgGithub.isValidUrl` and
`parseUrl` take a URL with or without its scheme. The fork has no release,
so no link to either address has to keep working.

The client stays on Create React App; a file-based router is a later
decision (`openspec/config.yaml`). The address chosen now has to be one such
a router can serve without a rewrite: a fixed first segment and one
catch-all.

## Goals / Non-Goals

**Goals:**

- One address for a GitHub import that a file-based router serves as
  `github/[...path]`.
- One place in the code that writes the address, so the dialog and a future
  caller agree.

**Non-Goals:**

- Changing how a repository is fetched or which files are kept
  (`PgGithub.getFiles`).
- Giving gists or shares a new address.
- Keeping the older addresses alive.

## Decisions

- **GitHub's path verbatim after `/github/`**, not `/github/<owner>/<repo>?ref=…&path=…`.
  The path is what a user copies from GitHub, so a link is written by
  prefixing it; and `parseUrl` already reads `tree/<ref>/<folder>`. A query
  form would need its own parser and a second encoding of the same thing.
- **No forward from the older addresses.** The fork is unreleased, so
  nothing links to them; a forward would be code kept for no caller and a
  second address for one view. They fall through to the not-found route.
- **The helper lives on `PgGithub`** (`routePath(url)`), in the legacy
  `utils` root the dialog and the route both import, rather than in
  `routes/`: `views/` importing `routes/` would be a cycle, since
  `routes/common` imports `views/`.
- **The spec capability is `client-v2-routes`**, new and shared, not a
  requirement added to `client-v2-layout`: the layout spec holds the page
  paths and how Back and Forward move between views; where a repository, a
  gist or a share opens is a different concern that later changes extend.

## Risks / Trade-offs

- [A path under `/github/` that is not a repository, such as
  `/github/settings`] → `isValidUrl("github.com/settings")` fails for want
  of a second segment, so the route declines and the not-found route takes
  it.
- [A GitHub path with characters `parseUrl` does not read] → unchanged: the
  same regular expression read the older address.
