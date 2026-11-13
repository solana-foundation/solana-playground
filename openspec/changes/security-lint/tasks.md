# Tasks

Groups 1, 2 and 3 may run at the same time. Inside group 1, 1.2 depends on 1.1.

## 1. ESLint

- [x] 1.1 Move client-v2 to ESLint 9 with `eslint.config.mjs` and no rule change (design.md, Decisions 1 to 3):
  rebuild `react-app` from its plugins, port `eslintConfig` and `eslint-layers.js`, drop `--ext`, port
  `untyped-eslint.mjs`, `ds-add.mjs` and `eslint-layers.test.mjs` (`lint-changed.mjs` builds `new ESLint({ cwd })`,
  which ESLint 9 keeps, and needs no change), switch `eslint-plugin-layers`
  to `context.filename` and `context.sourceCode`, drop `ESLintWebpackPlugin` in development, and update
  `client-v2/CLAUDE.md` where it names `eslintConfig`. Verify: the before-and-after JSON comparison in the PR shows
  the same errors and an equal or lower warning total; `yarn run check`, `yarn test-api` and `yarn lint:layers` pass;
  `yarn dev` starts and shows a type error in the overlay. HOO-2870.
- [x] 1.2 Add `eslint-plugin-no-unsanitized`, `@microsoft/eslint-plugin-sdl` and `eslint-plugin-security` at their
  current releases with the rules, levels and files in design.md, Decision 4; fix or disable with a reason every new
  error; raise `--max-warnings` by the new warning count. Verify: each scenario under the first three requirements of
  `specs/security-checks/spec.md` gives the stated result on a scratch file, and `yarn run check` passes. Depends on
  1.1. Ticket to file.

## 2. Workflow and Dockerfile scanners

- [x] 2.1 Add `.github/workflows/security.yml` with zizmor and hadolint as in design.md, Decision 5, every `uses:`
  pinned to a commit SHA; fix or suppress inline with a reason every finding of the first run, and list the count per
  rule in the PR. Run the workflow with act as `client-v2/docs/local-ci-with-act.md` describes before the push.
  Verify: the zizmor and hadolint scenarios in `specs/security-checks/spec.md` give the stated result on a throwaway
  branch, and the run on `master` after the merge shows both tools in Code scanning. Ticket to file.

## 3. CodeQL

- [ ] 3.1 A maintainer applies the default setup change in design.md, Decision 6, and triages the first `extended`
  scan's alerts. Verify: the scenario "Reading the configuration" in `specs/security-checks/spec.md`. Ticket to file.

## Workflow follow-up

- Secret scanning is HOO-2868, outside this change.
- Archive the change in the PR that ticks the last task, on a human's yes.
