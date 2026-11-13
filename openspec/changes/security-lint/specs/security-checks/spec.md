# Spec Delta

## Purpose

The automated security checks a change to the repository must pass before it merges, and the configuration of the
scanners that report to Code scanning, so a reviewer can tell which classes of defect CI catches.

## ADDED Requirements

### Requirement: client-v2 lint rejects untrusted HTML sinks

`yarn lint` SHALL fail on a file under `client-v2/src`, `client-v2/api` or `client-v2/e2e` that assigns a non-literal
value to `innerHTML` or `outerHTML`, or passes one to `insertAdjacentHTML`, `document.write` or
`document.writeln`. A sanctioned case passes only with an `eslint-disable-next-line` comment naming the rule and the
reason.

#### Scenario: A dynamic innerHTML assignment (manual)

- **WHEN** a file under `client-v2/src` gains `element.innerHTML = value`, where `value` is a variable
- **THEN** `yarn lint` exits non-zero and names the rule and the line

#### Scenario: A literal assignment (manual)

- **WHEN** a file under `client-v2/src` gains `element.innerHTML = ""`
- **THEN** `yarn lint` reports no error for that line

### Requirement: client-v2 lint rejects insecure browser APIs

`yarn lint` SHALL fail on a file under `client-v2/src`, `client-v2/api` or `client-v2/e2e` that posts a message to
the `*` target origin, sets `document.domain`, or names an `http:` URL in a string literal, other than a loopback
address and sdl's default exceptions for the `schemas.microsoft.com` and `schemas.openxmlformats.org` hosts and the
XHTML and SVG namespaces.

#### Scenario: postMessage to any origin (manual)

- **WHEN** a file under `client-v2/src` gains `window.parent.postMessage(data, "*")`
- **THEN** `yarn lint` exits non-zero and names the rule and the line

#### Scenario: A loopback URL (manual)

- **WHEN** a file under `client-v2/src` gains the literal `"http://localhost:3000"`
- **THEN** `yarn lint` reports no error for that line

### Requirement: client-v2 lint rejects literal cluster RPC addresses

`yarn lint` SHALL fail on a string literal, template literal or JSX text that names `api.devnet.solana.com`,
`api.testnet.solana.com` or `api.mainnet-beta.solana.com` in a file under `client-v2/src`, `client-v2/api`,
`client-v2/scripts` or `client-v2/e2e`, other than the module that defines `Endpoint`. A sanctioned case passes only
with an `eslint-disable-next-line` comment naming the rule and the reason.

#### Scenario: A cluster address in a test file (manual)

- **WHEN** a test file under `client-v2/src` gains the literal `"https://api.devnet.solana.com"`
- **THEN** `yarn lint` exits non-zero and names `no-restricted-syntax` and the line

#### Scenario: The Endpoint module (manual)

- **WHEN** `yarn lint` runs over `client-v2/src/entities/cluster/model/endpoint.ts`
- **THEN** it reports no `no-restricted-syntax` error for the addresses that module defines

### Requirement: client-v2 lint warns on Node security patterns

`yarn lint` SHALL report `eslint-plugin-security`'s recommended rules, except `detect-object-injection`, as warnings
counted under the `--max-warnings` cap, over `client-v2/src` and `client-v2/api`. `client-v2/scripts` and
`client-v2/e2e` are not checked by these rules.

#### Scenario: A dynamic RegExp (manual)

- **WHEN** a file under `client-v2/api` gains `new RegExp(input)`, where `input` is a variable
- **THEN** `yarn lint` reports a warning from `security/detect-non-literal-regexp` for that line

#### Scenario: A computed property read (manual)

- **WHEN** a file under `client-v2/src` gains `record[key]`, where `key` is a variable
- **THEN** `yarn lint` reports no `security/detect-object-injection` warning

### Requirement: Workflow files pass zizmor

Every PR and every push to `master` SHALL run zizmor over `.github/workflows` and `.github/actions`. A finding at or
above the configured severity SHALL fail the run, and the findings SHALL appear in Code scanning under the tool name
`zizmor` once the run is on `master`. An accepted finding is suppressed inline with a comment that gives the reason.

#### Scenario: An action pinned by tag (manual)

- **WHEN** a PR adds a step with `uses: actions/checkout@v4`
- **THEN** the zizmor job fails and its log names `unpinned-uses` and the line

#### Scenario: A clean workflow change (manual)

- **WHEN** a PR changes a workflow whose every `uses:` is pinned to a commit SHA and that interpolates no
  attacker-controlled expression into `run:`
- **THEN** the zizmor job passes

### Requirement: Fork-owned Dockerfiles pass hadolint

Every PR and every push to `master` SHALL run hadolint over `client-v2/Dockerfile` and
`docker/server-unstable.Dockerfile`. A warning or error SHALL fail the run, and the findings SHALL appear in Code
scanning under the tool name `hadolint` once the run is on `master`. The Dockerfiles under `client/`, `server/` and `wasm/` SHALL NOT be checked.

#### Scenario: An unpinned package install (manual)

- **WHEN** a PR adds `RUN apt-get install -y curl` to `client-v2/Dockerfile`
- **THEN** the hadolint job fails and names rule `DL3008`

#### Scenario: An upstream Dockerfile (manual)

- **WHEN** a PR changes `server/Dockerfile` only
- **THEN** the hadolint job reports no finding for it

### Requirement: CodeQL runs the extended suite on the shipped languages

CodeQL default setup on `solana-foundation/solana-playground` SHALL use the `extended` query suite and SHALL analyse
`actions`, `javascript-typescript` and `rust`, and no other language.

#### Scenario: Reading the configuration (manual)

- **WHEN** a maintainer runs `gh api repos/solana-foundation/solana-playground/code-scanning/default-setup`
- **THEN** `query_suite` is `extended` and `languages` holds `actions`, `javascript-typescript` and `rust`, and no
  `python`
