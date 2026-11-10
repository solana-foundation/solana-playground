# Proposal

## Why

A GitHub repository opened in the playground at its GitHub URL written after
the app's origin (`/https://github.com/<owner>/<repo>/…`): one URL inside
another, which reads as a mistake in the import dialog's explainer, and a
path no file-based router can serve when the client moves to one. The
address needs settling before the fork's first release puts links to it in
the wild.

## What Changes

- A repository, or a folder of one, opens at `/github/<owner>/<repo>` and
  `/github/<owner>/<repo>/tree/<ref>/<folder>`: GitHub's own path after
  `/github/`, one catch-all segment.
- **BREAKING (unreleased):** the older addresses, a GitHub URL after the
  origin (`/https://github.com/…`) and after `/github/`
  (`/github/https://github.com/…`), are removed with no forward. The fork has
  not been released, so no link to them exists to keep.
- The import dialog's explainer shows the `/github/` address, and an
  example's Open goes there.
- Telemetry: no events are added, renamed or removed. The route and the
  dialog live in the legacy roots (`routes/`, `views/`), outside any slice.
- Funnel: the step "Get a project: view a GitHub link" (`project_viewed`,
  pending in `funnel-events`) named `githubDefault` in
  `routes/github/github.tsx` as the code that sends it. That route is
  removed, so the funnel table and `client-v2-project-files` name the
  `github` route instead. The step "Get a project: import"
  (`project_imported`) keeps `ImportGithub` and its `Example`, which this
  change does not move.

## Capabilities

### New Capabilities

- `client-v2-routes`: the addresses of the client outside its pages and
  the work (which `client-v2-layout` holds): what each path opens and how
  the app writes a link to one. Starts with the GitHub import address;
  later changes add theirs here.

### Modified Capabilities

None. `client-v2-layout`'s requirement "Home, the pages and the work have
their own addresses" keeps the page paths; this capability holds the other
addresses.

## Impact

- `client-v2/src/routes/github/`: the `/github/{path}` route loads a
  repository; `/{githubUrl}` and the `/github/<URL>` forward are removed.
- `client-v2/src/utils/github.ts`: one helper turns a GitHub URL, with or
  without its scheme, into the route path, used by the dialog.
- `client-v2/src/views/sidebar/explorer/Component/Modals/ImportGithub.tsx`:
  the explainer's link and Open.
- `client-v2/e2e/github-import-links.e2e.spec.ts`: the dialog's recorded
  links and the route scenarios.
- `openspec/changes/funnel-events`: its table, spec, task 2.3 and design name
  the `github` route.
- Out of scope: the gist and share routes keep their addresses; the page
  paths (`/new`, `/tutorials`, `/programs`, `/home`) stay in
  `client-v2-layout`; `api/` is untouched; links in `client/public` and the
  Zero Copy docs to `beta.solpg.io/https://…` point at upstream's host and
  are not edited.
