# CLAUDE.md

Working notes for this repo. Style rules live in `CONTRIBUTING.md` — read it
before writing TypeScript or Rust; it is detailed and upstream-authoritative.
This file records only what the code and git history do not make obvious.

## This is a fork

`solana-foundation/solana-playground`, forked from
`solana-playground/solana-playground`.

`solana-foundation/solana-playground` `master` is the reference. Work lands
there through PRs, and upstream `solana-playground/solana-playground` reaches
it as squashed sync commits, each a chunk of upstream functionality, named
`chore(upstream): sync to <sha> (<range>)`. `hoodieshq/solana-playground`
forks `solana-foundation/solana-playground`; `master` is the default branch
of both.

Feature work is collected in hoodieshq before it reaches `master`: each plan
stage has an integration branch `scope/<stage>`, design polish has
`new-face-polish-2`, and each lands in foundation `master` as a whole through
one PR. A feature branch comes off its integration branch and its PR goes
against it; dev-process changes go straight to `master`.

`ci.yml` checks formatting for `client/`, `server/`, and `wasm/` and clippy
for `server/` and `wasm/`, but not `client/`'s build or tests;
`client-v2.yml` guards `client-v2/`, with its production build and the
checks on what that build emits in `reusable-client-v2-build.yml`. `ci.yml`
and `client-v2.yml` run on pushes to `master` and on every PR: a
`pull_request` run reads the workflow from the PR's merge commit, and no
`pull_request` workflow runs while the PR has a merge conflict.
`preview.yml` deploys a labelled PR's preview and `preview-sweep.yml`
cleans up after it on a schedule; both run only in the repository the
`PREVIEW_REPOSITORY` variable names, once `NEON_PROJECT_ID` is set there.
GitHub runs scheduled workflows only from the default branch.

`cicd.yml` deploys App Engine from a tagged commit on `master`. A push to
`master` also deploys `client-v2` to Vercel production, so run
`migrate-production-db` first when migrations are pending: "migrate first,
then merge to `master`"
([deploy-client-vercel.md, "Conversation and project sync"](client-v2/docs/deploy-client-vercel.md#conversation-and-project-sync)).

Greptile reviews only PRs into `master` on the foundation repository, as
`greptile.json` configures. When adding a file of review rules, add it to `customContext.files` in
`greptile.json`. Specs need no entry: its instructions point at `openspec/`.

## Two clients

- `client/` — upstream's. Largely untouched here. Don't edit unless the task
  says so.
- `client-v2/` — **where the fork's work happens**: the AI assistant panel, the
  Solana-brand theme, the four-column frame (`src/widgets/layout-shell`) and
  the Flow view inside it. Default to this one.

`server/` and `wasm/` are upstream's and out of scope per the project's
own principles ("No backend changes").

## Commit messages

The fork uses Conventional Commits (`feat:`, `fix:`, `chore:`, with an optional
`(client-v2)` / `(tutorials)` scope). This **contradicts `CONTRIBUTING.md`**,
which describes upstream's `server: Add feature` / no-prefix-for-client style.
Follow the fork's convention; follow CONTRIBUTING only in a PR meant for
upstream.

## Setup and commands

Node is pinned by `.nvmrc`; package manager is yarn 1.x.
All commands run from `client-v2/`.

```sh
../wasm/stub-packages.sh   # REQUIRED before first install (see below)
yarn install --frozen-lockfile
yarn dev                   # generate-fast + craco start
yarn build                 # the whole production build: wasm/build.sh, install, build:bundle (~1h first run)
yarn build:bundle          # lint:layers + generate + craco build + source-map upload, over whatever wasm/*/pkg holds; Vercel runs this
yarn test                  # test-types + test-unit + build:bundle
yarn test-types            # tsc --noEmit
yarn test-e2e              # playwright
yarn test-api              # node --test, for api/ and **/server/*.mjs
yarn bundle:info           # rewrite bench/BUNDLE.md from build/; commit it when bundle sizes move
yarn check-format          # prettier; CI enforces this
yarn lint                  # eslint over src/, api/, e2e/; CI enforces this
yarn spec:validate         # openspec validate --all --strict; CI enforces this
yarn run check             # everything CI runs, minus the production build;
                           # `run` is required: yarn 1's built-in `check` shadows the script
yarn db-migrate            # dbmate up; reads client-v2/.env
yarn db-status             # which migrations are applied
yarn db-dump               # regenerate db/schema.sql after a migration
```

`make help` at the root lists Vercel deploy targets.

Once per machine, for planning: `npm i -g @fission-ai/openspec@latest`
(or `brew install openspec`). The `/opsx:*` commands committed under
`.claude/` call it.

## Frontend rules and specs

`client-v2/CLAUDE.md` is loaded whenever work happens in that folder and
holds the rules for the client: layers, components, what review keeps
finding, the checklist before a PR, and the OpenSpec workflow. Specs and
change proposals live in `openspec/`; `openspec list` shows the changes
under `openspec/changes/`, which hold work with tasks left. Finished changes
are archived under `openspec/changes/archive/` and are a record, not work.
Asked to build something in the client, look in `openspec/changes/` first.

## Gotchas

- **Production runs one database, Postgres,** for conversation and project
  sync, reached only from `client-v2/api/*.mjs`. (Upstream's Rust build
  server in `server/` is written against MongoDB; it exists here only in the
  code and in the local `compose.yaml`, untouched.) Migrations live in
  `client-v2/db/migrations`, are applied with `yarn db-migrate`, and are never
  run from a serverless function. `db/schema.sql` is generated by
  `yarn db-dump` (which runs `pg_dump` inside the compose container, so no host
  Postgres client is needed) -- regenerate it whenever a migration changes.
- **`api/*.mjs` is not covered by `yarn test-unit`.** vitest collects
  `.js`, `.jsx`, `.ts` and `.tsx` test files under `src` and the in-source
  test blocks of `src/**/*.{ts,tsx}` (`include` and `includeSource` in
  `vitest.config.ts`), so no `.mjs`, and the server modules need real Node.
  Run `yarn test-api` (`node --test`); it loads `client-v2/.env`, and the
  database-backed cases skip themselves without `DATABASE_URL` rather than
  failing.
- **Secrets live in `client-v2/.env`**, not `.env.local` -- so dbmate and
  `yarn test-api` find them without an env prefix on the command. Both names
  are gitignored.
- **Sync and persistence gotchas** (chat threads, sync mark, merges, push gate, tabs,
  keypairs, diagnostics) live in `.claude/rules/project-sync.md`, which loads when a
  session reads a file under `client-v2/src/features/persistence`, `src/effects`,
  `src/views/sidebar/assistant`, `src/utils/explorer`, `src/components/Editor/Monaco`,
  `client-v2/api` or `client-v2/db`, or the program-info and tutorial modules. Read it
  before touching anything that reads or writes `/.config/chats`, `/.config/sync*` or
  `project_files` from elsewhere.
- **`wasm/` carries two fork-owned pins that an upstream sync must keep:**
  the exact `wasm-bindgen` version under `[workspace.dependencies]` in
  `wasm/Cargo.toml`, which every member that depends on `wasm-bindgen`
  references with `workspace = true`, and the one in
  `wasm/rust-analyzer/Cargo.toml`, outside the workspace. wasm-pack needs a
  `wasm-bindgen` binary at the exact crate version, and
  `client-v2/scripts/vercel-install.sh` installs it from what those pins lock
  (`client-v2/docs/deploy-client-vercel.md`, "wasm-bindgen"). A bump changes
  the pin and the lockfile together.
- **`wasm/stub-packages.sh` is not optional.** Six of the eight local
  `wasm/*/pkg` deps compile from Rust and take about an hour. `yarn install`
  refuses to run while those directories are missing. None is on the UI or test
  path, so the stubs are correct for everything except a real WASM build
  (`wasm/build.sh`). Rust intellisense and the `solana`/`anchor`/`spl-token`/
  `sugar` terminal commands are stubbed out and throw a clear message.
- **`client-v2/public/` is gitignored and generated**, not authored.
  `scripts/update-static.mjs` copies it out of the `client/public` git submodule
  and dates tutorials from that submodule's history — so the submodule needs
  full history (`fetch-depth: 0`), not a shallow checkout.
- **`docs/assistant-context.md` is the in-product assistant's context**, not
  Claude Code's. It is the source of truth; `yarn sync-assistant-context` copies
  it into `client-v2/src/views/sidebar/assistant/content/`. Edit the `docs/` copy.
  It is also the best single description of what the fork is building and what is
  real vs mocked — read it before answering product questions.
- **`docs/decisions.md`, `docs/product-brief.md` and `codebase-map.yaml` are
  referenced throughout but do not exist in this repo.** Don't cite them as if
  they do; the D-numbers in comments (`D6`, `D19`) have no resolvable target here.
- Building against the public server (`https://api.solpg.io`) works from
  `localhost:3000` — CORS allows it. No Docker or Rust toolchain needed to run
  the client.
