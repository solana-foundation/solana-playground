# Proposal

## Why

A GitHub repository opens in the playground at its GitHub URL written after
the app's origin (`/https://github.com/<owner>/<repo>/…`): one URL inside
another, which reads as a mistake in the import dialog's explainer, and a
path no file-based router can serve when the client moves to one. The
address needs settling before more links to it are written.

## What Changes

- A repository, or a folder of one, opens at `/github/<owner>/<repo>` and
  `/github/<owner>/<repo>/tree/<ref>/<folder>`: GitHub's own path after
  `/github/`, one catch-all segment.
- The older address, a GitHub URL after the origin, keeps working: it forwards
  to the `/github/` address and replaces its own history entry, so Back never
  returns to it. Upstream's tutorial content and shared links carry it.
- The import dialog's explainer shows the `/github/` address, and an
  example's Open goes there.
- Telemetry: no events are added, renamed or removed. The route and the
  dialog live in the legacy roots (`routes/`, `views/`), outside any slice.
- Funnel: the step "Get a project: view a GitHub link" (`project_viewed`,
  pending in `funnel-events`) names `githubDefault` in
  `routes/github/github.tsx` as the code that sends it. That route becomes
  the forward, so the table SHALL name the `/github/` route instead, and the
  forward sends nothing, so a visit is counted once. The step "Get a
  project: import" (`project_imported`) keeps `ImportGithub` and its
  `Example`, which this change does not move.

## Capabilities

### New Capabilities

- `client-v2-routes`: the addresses of the client outside its pages and
  the work (which `client-v2-layout` holds): what each path opens, which
  older forms forward where, and how the app writes a link to one. Starts
  with the GitHub import address; later changes add theirs here.

### Modified Capabilities

None. `client-v2-layout`'s requirement "Home, the pages and the work have
their own addresses" keeps the page paths; this capability holds the other
addresses, and the two reference each other.

## Impact

- `client-v2/src/routes/github/`: the `/github/{path}` route becomes the one
  that loads a repository; `/{githubUrl}` forwards to it.
- `client-v2/src/utils/github.ts`: one helper turns a GitHub URL into the
  route path, used by the route's forward and the dialog.
- `client-v2/src/views/sidebar/explorer/Component/Modals/ImportGithub.tsx`:
  the explainer's link and Open.
- `client-v2/e2e/github-import-links.e2e.spec.ts`: the dialog's recorded
  links and the route scenarios.
- Out of scope: the gist and share routes keep their addresses; the page
  paths (`/new`, `/tutorials`, `/programs`, `/home`) stay in
  `client-v2-layout`; `api/` is untouched; the content under
  `client/public` that links the older form is upstream's and is not edited,
  the forward serves it.
