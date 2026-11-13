# Tasks

Groups 1, 2 and 3 may run at the same time. Inside group 1, 1.2 depends on 1.1 and 1.3 on 1.2.

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
  error; clear every new warning, fixed or disabled with a reason, so `--max-warnings` is unchanged. Verify: each
  scenario under the requirements "client-v2 lint rejects untrusted HTML sinks", "client-v2 lint rejects insecure
  browser APIs" and "client-v2 lint warns on Node security patterns" in `specs/security-checks/spec.md` gives the
  stated result on a scratch file, and `yarn run check` passes. Depends on 1.1. HOO-2892.
- [x] 1.3 Fail the lint on a literal cluster RPC address outside the `Endpoint` module, as the requirement "client-v2
  lint rejects literal cluster RPC addresses" states: move `Endpoint` to `entities/cluster/model/endpoint.ts`, take
  test RPCs from `src/test-utils/endpoints.mjs` on the `.test` TLD, and replace every literal under `src`, `api`,
  `scripts` and `e2e` or disable the rule on its line with a reason. Verify: the cluster-address rows of `scripts/eslint-security.test.mjs` pass, and `yarn lint`
  reports no error. Depends on 1.2. HOO-2892.

## 2. Workflow and Dockerfile scanners

- [x] 2.1 Add `.github/workflows/security.yml` with zizmor and hadolint as in design.md, Decision 5, every `uses:`
  pinned to a commit SHA; fix or suppress inline with a reason every finding of the first run, and list the count per
  rule in the PR. Run the workflow with act as `client-v2/docs/local-ci-with-act.md` describes before the push.
  Verify: the zizmor and hadolint scenarios in `specs/security-checks/spec.md` fail and pass as stated, under act and
  in the CI logs of this PR, whose fork branch skips the upload. HOO-2892.

## 3. CodeQL

- [ ] 3.1 A maintainer applies the default setup change in design.md, Decision 6, and triages the first `extended`
  scan's alerts. Verify: the scenario "Reading the configuration" in `specs/security-checks/spec.md`. Ticket to file.

## Workflow follow-up

- Secret scanning is HOO-2868, outside this change.
- Before archiving, confirm the first `master` run of `security.yml` shows zizmor and hadolint in Code scanning.
- Archive the change in the PR that ticks the last task, on a human's yes.
