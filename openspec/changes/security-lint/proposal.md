# Proposal

## Why

The repository is public and serves untrusted users. The only automated security analysis on it is CodeQL default
setup, on the `default` query suite. No check fails a PR that writes untrusted HTML into the DOM in client-v2, that
gives a workflow a write token or an unpinned action, or that ships a Dockerfile running as root. The three ESLint
security plugins wanted for client-v2 publish their maintained releases for ESLint 9 only, and client-v2 is on
ESLint 8.40 through `react-scripts`.

## What Changes

- client-v2 lints with ESLint 9 and a flat config (`client-v2/eslint.config.mjs`). The `eslintConfig` block in
  `client-v2/package.json` and the `react-app` preset go; the plugins that preset bundled are configured directly.
  Every rule that is an error stays an error, and the warning total does not grow.
- **BREAKING (developers only):** the development server no longer reports ESLint problems in its overlay. CRA's
  `ESLintWebpackPlugin` reads ESLint 8 configuration and is dropped in development as it already is in production.
  `yarn lint`, the pre-push `check`, the Claude Code edit hook and `scripts/lint-changed.mjs` report them instead.
  Type errors still show in the overlay.
- client-v2 lints with `eslint-plugin-security`, `eslint-plugin-no-unsanitized` and `@microsoft/eslint-plugin-sdl`,
  each at its current release.
- A `security.yml` workflow runs zizmor over `.github/` and hadolint over `client-v2/Dockerfile` and
  `docker/server-unstable.Dockerfile` on every PR and on pushes to `master`. A finding fails the run, and each tool
  uploads SARIF to Code scanning.
- CodeQL default setup runs the `extended` query suite and no longer analyses Python.
- Telemetry: no slice under `features/` or `widgets/` changes, so no event is added, renamed or removed. No funnel
  step's code changes.

User-visible consequence: none in the app. A PR author sees new failing checks where the code matches one of these
rules, and more CodeQL alerts in the Security tab.

## Capabilities

### New Capabilities

- `security-checks`: the automated security checks a change must pass before it merges: the ESLint security rules
  in client-v2, the workflow and Dockerfile scanners, and the CodeQL configuration.

### Modified Capabilities

None. `client-v2-build` ("Type checking and linting gate the merge, not the build") requires type errors, not lint
problems, in the development overlay, so dropping the lint overlay leaves it true.

## Impact

- **Code:** `client-v2/package.json` (dependencies, `lint` and `lint:layers` scripts), a new
  `client-v2/eslint.config.mjs`, `client-v2/eslint-layers.js`, `client-v2/eslint-plugin-layers/index.js`,
  `client-v2/craco.config.js`, `client-v2/scripts/lib/untyped-eslint.mjs`, `client-v2/scripts/lint-changed.mjs`,
  `client-v2/scripts/ds-add.mjs`, `client-v2/scripts/eslint-layers.test.mjs`, `client-v2/CLAUDE.md` where it names
  `eslintConfig`. Fixes in source files for findings the new rules raise as errors.
- **CI:** a new `.github/workflows/security.yml`. Fixes to existing workflows and to the two Dockerfiles for zizmor and
  hadolint findings.
- **Repository settings:** the CodeQL default setup configuration, changed by a maintainer with `gh api`.
- **Out of scope:** secret scanning (HOO-2868); Semgrep (its registry rulesets duplicate the tools here or target
  libraries client-v2 does not use, and the Semgrep Rules License forbids copying them into a public repository);
  hadolint on `client/`, `server/` and `wasm/` Dockerfiles, which follow upstream; ESLint on `client/`; CodeQL
  advanced setup; the `remote_and_local` threat model; Rust linting.
