# Design

## Context

See [proposal.md](proposal.md), "Why". Facts that shape the approach:

- client-v2 runs ESLint 8.40, which `react-scripts` 5.0.0 brings. The configuration is the `eslintConfig` block in
  `client-v2/package.json`: it extends `react-app` and `./eslint-layers.js` and holds the project's overrides.
- `eslint-config-react-app` 7.0.1, its latest release, declares `eslint: ^8.0.0`.
- Of the three security plugins, `eslint-plugin-no-unsanitized` 4.1.5 declares `eslint: ^9 || ^10`,
  `@microsoft/eslint-plugin-sdl` 1.1.0 declares `eslint: ^9`, and `eslint-plugin-security` 4.2.1 declares no ESLint
  range and ships both `recommended` and `recommended-legacy`.
- `eslint-plugin-boundaries` declares `eslint: >=6.0.0`. `eslint-plugin-unicorn` 47.0.0 predates flat config.
- Four scripts drive ESLint through its Node API or CLI flags: `scripts/lib/untyped-eslint.mjs` (`overrideConfig` in
  eslintrc shape), `scripts/lint-changed.mjs` (`new ESLint({ cwd })` only, which ESLint 9 keeps), `scripts/ds-add.mjs`
  (relies on `--quiet` limiting `--fix` to errors) and `scripts/eslint-layers.test.mjs`. The `lint` and `lint:layers` scripts pass `--ext`, which ESLint 9 removed.
- `eslint-plugin-layers` calls `context.getFilename()` and `context.getSourceCode()`. ESLint 9 deprecates both and
  ESLint 10 removes them.
- `craco.config.js` drops CRA's `ESLintWebpackPlugin` in production only (`BUILD_ONLY_CHECKS`), so the development
  server lints on every compile.
- `typescript` is pinned to 5.0.4, so every TypeScript-aware ESLint package must accept that version.
- PRs reach `solana-foundation/solana-playground` from the `hoodieshq` fork. A `pull_request` run from a fork gets a
  read-only `GITHUB_TOKEN`, which cannot upload SARIF.
- CodeQL default setup: `query_suite: default`, languages `actions`, `javascript`, `javascript-typescript`, `python`,
  `rust`, `typescript`, threat model `remote`, read on 2026-11-13.

## Goals / Non-Goals

**Goals:**

- ESLint 9 lands with no change in what the lint reports, so the migration and the new rules are reviewed apart.
- Each new check fails CI on a finding from its first merged run, with the existing findings fixed or suppressed
  with a reason in the PR that adds it.

**Non-Goals:**

- Tightening rules beyond the three plugins, or lowering `--max-warnings` as part of the migration.
- Moving off Create React App.

## Decisions

### 1. A flat config that rebuilds `react-app` from its plugins

`client-v2/eslint.config.mjs` holds the whole configuration. The `react-app` preset is replaced by the plugins it
bundles, configured directly: `typescript-eslint`, `eslint-plugin-react`, `eslint-plugin-react-hooks`,
`eslint-plugin-jsx-a11y`, `eslint-plugin-import` and `eslint-plugin-jest`, with the rule levels `react-app` sets.
`eslint-layers.js` exports a flat config array. Every override in `eslintConfig` becomes a config object with the
same `files`, `ignores` and rules.

Alternative: wrap `eslint-config-react-app` with `FlatCompat` from `@eslint/eslintrc`. Rejected: the preset declares
ESLint 8 only, so every later bump runs it outside its supported range, and its parser chain (`babel-preset-react-app`)
is configured for CRA's Babel, not for this repository's TypeScript.

### 2. Parity is measured, not assumed

The ESLint 9 PR records, before and after, `eslint --format json` over every folder `yarn lint` covers, and compares
the set of (file, rule, severity) for errors and the warning total. The PR passes when the error sets match and the
warning total is equal or lower. A rule whose behaviour changed in a plugin bump is named in the PR with its count.
`--max-warnings` is set to the new total.

### 3. The development server stops linting

`ESLintWebpackPlugin` joins the plugins `craco.config.js` drops, in development as well. Alternative: upgrade
`eslint-webpack-plugin` and point it at the flat config. Rejected: it adds the full lint to every development
compile, and the edit hook, `lint-changed.mjs` and the pre-push `check` already report lint problems.
`ForkTsCheckerWebpackPlugin` stays in development, so the `client-v2-build` requirement on type errors in the overlay
holds.

### 4. Rule selection and severity

| Source | Rules | Level | Files |
| --- | --- | --- | --- |
| `eslint-plugin-no-unsanitized` | `method`, `property` | error | `src`, `api`, `e2e` |
| `@microsoft/eslint-plugin-sdl` | `no-postmessage-star-origin`, `no-document-domain`, `no-document-write`, `no-insecure-url` (loopback hosts excepted) | error | `src`, `api`, `e2e` |
| `eslint-plugin-security` | `recommended`, without `detect-object-injection` | warn | `src`, `api` |

`sdl` rules are enabled one by one, not through its `recommended` config, which also enables its React and Node
configs and would repeat rules Decision 1 already sets. `sdl/no-inner-html` is left off because `no-unsanitized`
covers the same sinks. `detect-object-injection` reports nearly every computed member access and is off.
`no-unsanitized/method` skips `import()` only in `**/*.test.mjs` and the `create.ts`/`create.tsx` factories, which
import their own folder's modules by name.
`scripts/` is excluded from `security/*`: it is build tooling that reads paths and spawns processes by design.
`--max-warnings` rises by exactly the number of new warnings. Errors the new rules raise are fixed in the same PR,
or disabled on the line with the reason.

### 5. A separate `security.yml`

The scanners run in `.github/workflows/security.yml`, not in `ci.yml`, so `security-events: write` is granted to
that workflow alone. Triggers match `ci.yml`: `pull_request` and `push` to `master`.

- zizmor runs through `zizmorcore/zizmor-action`, hadolint through `hadolint/hadolint-action`, each pinned to a
  commit SHA.
- The tool's exit status fails the job on every run. The SARIF upload (`github/codeql-action/upload-sarif`) runs
  only when the token can write: on `push`, and on a `pull_request` whose head repository is this repository. A PR
  from the fork therefore shows findings in the job log, and Code scanning shows the state of `master`.
- hadolint reads `client-v2/Dockerfile` and `docker/server-unstable.Dockerfile` by path, with `failure-threshold:
  warning`.

### 6. CodeQL stays on default setup

A maintainer applies the setting with:

```sh
gh api -X PATCH repos/solana-foundation/solana-playground/code-scanning/default-setup \
  -f query_suite=extended \
  -f 'languages[]=actions' -f 'languages[]=javascript-typescript' -f 'languages[]=rust'
```

Alternative: advanced setup with a `codeql.yml`. Rejected for this change: default setup already covers the
languages, and a workflow file is one more file to keep pinned and reviewed.

## Risks / Trade-offs

- [A plugin bump changes what a rule reports, for example `eslint-plugin-unicorn` past 47] → Decision 2 names each
  such rule with its count; a rule that grows by more than the PR can fix keeps its old behaviour through options or
  is set to its previous version.
- [A TypeScript-aware package drops TypeScript 5.0] → pick the newest `typescript-eslint` release whose peer range
  includes 5.0.4, and record the reason next to the pin.
- [yarn 1 hoists ESLint 9 to the top level and `react-scripts` keeps ESLint 8 nested] → nothing runs the nested copy
  once Decision 3 lands; `yarn why eslint` in the PR shows which copy the scripts load.
- [`ds-add.mjs` relies on ESLint 8 `--quiet` semantics] → in ESLint 9 `--quiet` skips warning rules entirely, so
  `--fix` still applies only error fixes; the PR runs `yarn ds-add <item> --dry-run` and a real install to confirm.
- [The `extended` suite raises alerts the team has not triaged] → the first scan's alerts are triaged in Code
  scanning: fixed, or dismissed with a reason. No PR is blocked on them, because default setup does not gate merges.
- [zizmor's first run on 12 workflows reports many findings] → the zizmor PR fixes them or suppresses each inline
  with the reason, and lists the count per rule.

## Migration Plan

Each task is one PR and reverts on its own. Reverting the ESLint 9 PR also requires reverting the security plugins
PR, which depends on it. The CodeQL setting reverts with the same command and `query_suite=default`.
