# Tasks

## 1. The address

- [ ] 1.1 Make `/github/{path}` the route that loads a repository, forward
      `/{githubUrl}` to it with the history entry replaced, and add
      `PgGithub.routePath(url)`. Verify: unit tests for `routePath` (with and
      without the scheme, the folded form, a trailing slash) in
      `client-v2/src/utils/github.test.ts`; the `/github/…` address and the
      older one both open the Hello Solana example in the browser; the
      funnel table in `openspec/changes/funnel-events/specs/client-v2-funnels/spec.md`
      names the `/github/` route, not `githubDefault`, for `project_viewed`.
      Ticket to file.

## 2. The dialog

- [ ] 2.1 The import dialog's explainer shows the `/github/` address and says
      repositories are viewed at `/github/` followed by their GitHub path; an
      example's Open navigates through `routePath`. Verify: the dialog's unit
      tests in `ImportGithub.test.tsx` pass, and the explainer's link opens
      the program in a new tab. Depends on 1.1. Ticket to file.

## 3. The scenarios

- [ ] 3.1 The e2e spec `client-v2/e2e/github-import-links.e2e.spec.ts` drives
      the `/github/` address, has a test for the older address forwarding,
      and titles each test `client-v2-routes: <scenario>` after the spec's
      scenarios. Verify: `yarn test-e2e e2e/github-import-links.e2e.spec.ts`
      passes, and `yarn spec:coverage` lists no `client-v2-routes` scenario
      as uncovered. Depends on 1.1 and 2.1. Ticket to file.
