# Design

## Context

The router (`PgRouter`, `client-v2/src/utils/router.ts`) matches `{param}`
templates; a parameter at the end of a template takes the rest of the path,
slashes included. Two routes serve GitHub today: `/{githubUrl}`, validated
by `PgGithub.isValidUrl`, which loads the repository, and `/github/{url}`,
which forwards a full GitHub URL to the first. `PgGithub.isValidUrl` and
`parseUrl` already take a URL with or without its scheme, and with the
single slash react-router folds `//` into on an in-app navigation.

The client stays on Create React App; a file-based router is a later
decision (`openspec/config.yaml`). The address chosen now has to be one such
a router can serve without a rewrite: a fixed first segment and one
catch-all.

This change's code exists on the working tree of `scope/interface-2` at the
time of writing; the tasks below are what its PR lands and ticks.

## Goals / Non-Goals

**Goals:**

- One canonical address for a GitHub import that a file-based router serves
  as `github/[...path]`.
- Every older address still opens the same program, with no history entry
  of its own.
- One place in the code that writes the address, so the dialog, the forward
  and a future caller agree.

**Non-Goals:**

- Changing how a repository is fetched or which files are kept
  (`PgGithub.getFiles`).
- Giving gists or shares a new address.
- Editing upstream's content under `client/public` that links the older
  form.

## Decisions

- **GitHub's path verbatim after `/github/`**, not `/github/<owner>/<repo>?ref=…&path=…`.
  The path is what a user copies from GitHub, so a link is written by
  prefixing it; and `parseUrl` already reads `tree/<ref>/<folder>`. A query
  form would need its own parser and a second encoding of the same thing.
- **The canonical route loads; the older route forwards**, not the other
  way round. The e2e tests and the dialog name the canonical address, and
  the forward is the one place that knows the older form. The forward uses
  `navigate(path, { replace: true })`, which the router already has for a
  route that only forwards.
- **The helper lives on `PgGithub`** (`routePath(url)`), in the legacy
  `utils` root the dialog and the routes both import, rather than in
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
- [A GitHub path with characters `parseUrl` does not read] → unchanged from
  today: the same regular expression read the older address.
- [Links in the wild to the older address] → the forward keeps them working;
  the e2e scenario for it fails if the forward goes.
