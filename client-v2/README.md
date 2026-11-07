## Client

This is the main application of Solana Playground.

## Setup

`wasm/*/pkg` is gitignored, so a fresh clone or a new worktree has never
built it. `yarn install` cannot resolve the local `file:` dependencies until
`wasm/*/pkg` exists.

**Fresh clone or new worktree.** Compile the WASM packages from Rust, then
install and generate:

```sh
yarn setup
yarn start
```

`yarn setup` (`scripts/setup-wasm.sh`) builds `wasm/*/pkg` with
`../wasm/build.sh` into the checkout's own cargo target folders, `wasm/target`
and `wasm/rust-analyzer/target`. A folder shared between worktrees is unsafe:
cargo names a path `cdylib` without a hash and judges freshness by mtime, so
one worktree could package another's `.wasm`. In a linked worktree, a target
folder that does not exist yet starts as a copy of the main checkout's (an
APFS clone on macOS), so only a checkout with nothing to copy from runs the
cold build, which takes about an hour; the worktree's own crates still compile
once. `setup` unsets a `CARGO_TARGET_DIR` set by the user, and fails when a
cargo config's `build.target-dir` moves either target folder elsewhere. It then
clears `node_modules` (all but `.cache`, less webpack's `default-<mode>` caches) and
installs, because yarn 1 copies a local `file:` package again only when its
folder is missing, and an install over an old tree can keep a hoisting the
lockfile no longer describes. Webpack's cache goes because it identifies a
package by name and version, which a rebuilt wasm package keeps.

**Stubs, by request only.** `USE_WASM_STUBS=true` (the exact string `true`)
writes placeholder packages with `../wasm/stub-packages.sh` instead of
compiling them. The scripts with the `:with-stubs` suffix set it themselves:

```sh
yarn setup:with-stubs
yarn dev:with-stubs
yarn test-e2e:with-stubs
```

The stubs lose Rust intellisense, the `solana`, `anchor`, `spl-token` and
`sugar` terminal commands, and Seahorse builds. `yarn start`, `yarn dev`,
`yarn dev-cra` (and so `yarn dev-vercel`), and `yarn test-e2e` stop with the
names of the stubbed packages when they find stubs in `node_modules` and
`USE_WASM_STUBS=true` is not set. `yarn test-e2e:with-stubs` leaves out the
`@real-wasm` specs, which run the CLIs. A deployment refuses the
variable, and the Vercel build fails on a bundle built from a stub
(`node scripts/wasm-stubs.mjs check-build build`). `yarn setup` replaces the
stubs with the real packages.

**Production build.** `yarn build` is the whole build in one command: it
compiles and installs `wasm/*/pkg` as `yarn setup` does (`scripts/setup-wasm.sh`,
which clears `node_modules` first so it takes the new packages), generates the
crate, package and tutorial data, and bundles the app into `build/`. A first run takes about an hour;
cargo reuses its output after that.

`yarn build:bundle` skips the Rust step and the reinstall, and bundles whatever
`wasm/*/pkg` holds, stubs included. Vercel calls it, because its install step
(`scripts/vercel-install.sh`) has already built or restored the packages.
`yarn build-fast` also skips the crate data, for a quicker check that the
bundle compiles.

**Source maps.** A production build emits hidden source maps (no
`sourceMappingURL`, so browsers never fetch them); a preview emits them only
with `SOURCEMAPS_PREVIEW_ENABLED=true`, and a local or CI build never does
(`scripts/sourcemap-gate.mjs`). The last step of `build:bundle`,
`scripts/upload-sourcemaps.mjs`, uploads them to Sentry with `sentry-cli`, then
deletes every map from `build/` and fails if one is left, so none is deployed.
It fails the build only on a configuration error: the gate is on and the build
emitted no maps, or a production build has no `SENTRY_AUTH_TOKEN`. A failed
upload (Sentry down, a rejected token) warns and deploys without maps, so it
never blocks a hotfix; a preview without the token warns too. Set the token in
the Vercel project's environment variables: the script loads no `.env` file.

**Planning tools (once per machine).** Specs and change proposals are
managed with [OpenSpec](https://openspec.dev). The CLI is global, not a
project dependency:

```sh
npm i -g @fission-ai/openspec@latest   # or: brew install openspec
openspec --version                     # 1.14.0 or newer
```

Without it the `/opsx:*` commands in Claude Code stop at "CLI not found";
the `spec:validate` script still works, because `client-v2` pins the same
package as a devDependency for CI. The rules for contributors and agents are in
[`CLAUDE.md`](CLAUDE.md); the specs are in [`../openspec/`](../openspec/README.md).

### Checks

`yarn run check` runs what CI runs, in CI's order, minus the production build:
`test-types`, `check-format`, `lint`, `spec:validate`, `spec:coverage`,
`test-unit`, `test-api`. The `run` is required: yarn 1's built-in `check`,
which compares `node_modules` with `yarn.lock`, shadows the script.
`test-unit` runs the test files that `include` in `vitest.config.ts` matches
and the in-source test blocks of the modules ([`AGENTS.md`](AGENTS.md)); a
module's block alone runs
with its path, `yarn test-unit src/features/persistence/model/project-id.ts`.
Run `check` before a
push, or make git do it:

```sh
git config core.hooksPath .githooks   # once per clone; runs `check` on pre-push
```

`spec:validate` runs the OpenSpec CLI pinned in `devDependencies`, so its
verdict is the one CI sees whatever version is installed globally.

`bundle:info` rewrites [`bench/BUNDLE.md`](bench/BUNDLE.md), the committed
sizes of the production bundle, from `build/`. Run it after `yarn build-fast`
when a change moves bundle sizes and commit the file: `yarn test-build` fails
while the snapshot differs from the build. CI measures the merge commit, so
rebase onto the base branch first, and build with
`REACT_APP_GA_MEASUREMENT_ID= yarn build-fast`: CI's build has no GA id, and
the empty value keeps CRA from taking one from `.env` (dotenv does not override
a variable already set). Sentry stays out of a build without `VERCEL_ENV`
(`sentryEnabled` in `scripts/sentry-gate.mjs`).

## Static assets

`public/` is tracked files, served as they are; edit them in place, except
`index.html`, which stays upstream's (see "Brand icons"). Every file there is
served, a README included, so notes about them live here. The
`generate` scripts add `public/crates`, `public/packages`, and each Markdown
tutorial's `content.json`, which stay gitignored.

The files that are not the fork's own started as upstream's
[assets repository](https://github.com/solana-playground/assets) at the commit
in `scripts/assets-commit.txt`. That file records where the copy came from; an
upstream sync copies upstream's asset changes as they are and updates it.

Every upstream tutorial folder lands in `public/tutorials/`, but the app shows
a Markdown tutorial only when
[`src/tutorials/markdown-tutorials.json`](src/tutorials/markdown-tutorials.json)
lists its folder name. Each entry's `added` is the tutorial's date in Unix
seconds, read as its `unixTimestamp`; the copy has no upstream history to date
it from. The build fails on a listed name whose folder or `data.json` is
missing ([`src/tutorials/README.md`](src/tutorials/README.md)).

### Brand icons

The page icon, the home-screen icon and the install icons, rendered by design
(Almaz, 4 Nov 2026, HOO-2568) from the triangle-and-circle mark on the brand
gradient, with the fork's `manifest.json`. They replace upstream's
`favicon.ico` and `manifest.json`; upstream's `logo192.png` and `logo512.png`
stay in `public/`, unreferenced. The served page's head points at these files,
sets `theme-color`, and carries the share card (Open Graph and Twitter tags,
with `og.png`), so a browser, a crawler, a link preview or a home screen reads
them from the markup without running the bundle.

`public/index.html` itself is upstream's file, copied as is. `craco.config.js`
passes it through `brandHeadFor` (`scripts/brand-head.mjs`) when webpack
writes the page, in `yarn dev` and in the production build alike, and a page
whose head the rewrite cannot place fails the build. An edit to
`public/index.html` reaches `yarn dev` after a restart. The card's absolute
URLs name `SITE_URL` when it is set, else
`https://$VERCEL_PROJECT_PRODUCTION_URL`, which Vercel sets on every build,
else `http://localhost:3000` (`resolveSiteUrl`); a value that is not an
`http(s)` origin fails the build.

| File | Used for |
| --- | --- |
| `favicon.ico` | 16 and 32 px tab icon; what crawlers read |
| `favicon.svg` | tab icon in browsers that take SVG |
| `favicon-96x96.png` | larger tab and shortcut icon |
| `apple-touch-icon.png` | iOS home screen, 180 px, square and opaque: iOS rounds it |
| `icon-192.png`, `icon-512.png` | manifest icons, purpose `any` |
| `icon-maskable-512.png` | manifest icon, purpose `maskable` (Android crops it) |
| `manifest.json` | install name, icons and colours; `scripts/brand-manifest.test.mjs` checks it |
| `og.png` | share card image, 1200 x 630 |

`#101011` in `manifest.json` and `theme-color` is the design system's
`--background` (dark theme), the product's ground. Icon paths in it are
relative to the manifest, like `start_url`. The card's URLs are absolute,
because crawlers do not resolve relative ones. A new render replaces the file
under the same name.

### The program gallery

`public/programs/programs.json` is the list the Programs gallery and Home's
program count read (`/programs/programs.json`, `entities/program`). It is
curated, not upstream's list.

Every listed program is code a person can open, build and deploy from
Playground with one press, so the list is a curated surface, not a mirror of
the ecosystem (security review, 29 Oct 2026).

A program is listed only when all of these hold:

1. **It builds on the default build server.** Open the card in Playground and
   press Build with the default server (Solana Foundation): the output ends in
   `Finished release` with no `could not compile`. The server compiles against
   its own fixed crate list, ignores the program's `Cargo.toml`, and refuses
   more than 64 source files, so most large protocols fail.
2. **It is Solana-native or notable.** A program from Solana itself (SPL,
   Anza, Solana Foundation) or a protocol people recognise and would want to
   read. No forks, demos or abandoned experiments.
3. **It opens.** The link names a ref (`/tree/<ref>/<path>`; the URL's shape
   is checked by `scripts/programs-list.test.mjs`, the folder by hand) and
   that folder holds the program's `src/`. A program whose repository moved
   or rewrote it for newer crates is pinned to the last tag or commit that
   still builds: the SPL programs here come from the archived
   `solana-program-library`, pinned at `token-v4.0.0`, because its `master`
   dropped some of them and their new homes in `solana-program/*` need crates
   the server lacks. A repository without a usable tag is pinned to a
   commit.

Programs leave as well as enter: a repository that moves, or a build server
whose crates change, can break a card that worked. Check every card before a
release and after a build-server change, and drop what no longer builds.

Last checked 3 Nov 2026 against the Foundation server, for HOO-2527: all
eleven build. On 7 Nov Bonfida's `token-vesting`, the one non-SPL entry,
was dropped: in the app its card never finished building (HOO-2700), so ten
remain. Of upstream's 34, only four did (HOO-2421: spl-memo,
spl-name-service, spl-noop and spl-stake-pool): the rest hit missing
crates (most Anchor protocols and SPL programs), more than 64 source files
(mpl-token-metadata, openbook-v2), or a 502 from the server (drift-v2,
mango-v4, marginfi, whirlpool).

Anchor protocols mostly fail on the crate list, not on their size. The server
compiles Anchor 0.29 against `solana-program` 1.16 and lacks crates common in
protocol code (`solana-security-txt`, `uint`, `spl-memo`, `mpl-core`,
`fixed`), so code written for Anchor 0.28 (`ctx.bumps.get`) or 0.30+ fails as
well. Tried and refused on 3 Nov: raydium-cp-swap, raydium-clmm, squads-v4,
jito tip-payment and tip-distribution, mpl-hybrid, mpl-candy-machine-core,
mpl-candy-guard, mpl-inscription, marinade validator-bonds, tensor
marketplace and whitelist.

## Docker

Run client-v2 with everything it talks to via [Docker Compose](https://github.com/docker/compose).
`compose.yaml` is a local development layout, not a production one.

```sh
docker compose -f ../compose.yaml --profile v2 up --build       # dev server, `yarn start`
docker compose -f ../compose.yaml --profile v2-prod up --build  # production bundle
```

Both profiles start the same services:

| Service             | What it does                                                                 |
| ------------------- | ---------------------------------------------------------------------------- |
| `wasm`              | Builds the real `wasm/*/pkg` packages (`wasm/build.sh`); the client image copies them in. Never stubs. |
| `postgres`          | Conversation and project sync, on host port `PG_POSTGRES_PORT` (5432).       |
| `migrate`           | Runs dbmate over `db/migrations` once Postgres is healthy, then exits.       |
| `server-standalone` | The Rust build server on `http://localhost:8080` (`PG_PORT`). |
| `client-v2` / `client-v2-prod` | The client on `http://127.0.0.1:3000` (`PG_CLIENT_V2_PORT`), started once `wasm` and `migrate` have exited 0. |

`client-v2-prod` runs `yarn build:bundle`, refuses to serve a bundle that
`node scripts/wasm-stubs.mjs check-build build` rejects, and then serves
`build/` and `api/*.mjs` with `scripts/serve-build.mjs`, following
`vercel.json`'s headers and rewrites. `client-v2` serves `api/*.mjs` from the
dev server, through the same dispatcher (`scripts/api-route.mjs`).

The compose file sets `DATABASE_URL` (the compose Postgres), `SYNC_ENABLED`,
`AUTH_BASE_URL` and `REACT_APP_SERVER_URL` itself; those values win over
`.env`. Open the app on the origin `AUTH_BASE_URL` names,
`http://127.0.0.1:3000` by default: the API refuses sync writes from any other
origin, `http://localhost:3000` included. To use another origin, set
`AUTH_BASE_URL` in the shell that runs `docker compose`. Everything else, such as the GitHub OAuth app, `AUTH_SECRET` and the
model keys, comes from `client-v2/.env` when it exists (names in
`.env.example`). The file reaches the containers through `env_file`; it is
kept out of the image.

### The unstable server

The `v2-unstable` profile runs the same services with `server-unstable` in
place of `server-standalone`: the build server compiled with
`--features unstable`, which serves `/unstable/build` and `/unstable/bundle`
and runs each build in a sandbox container. It is for local use only: the
service mounts `/var/run/docker.sock`, which gives the container control of
the host's Docker daemon.

```sh
docker compose -f ../compose.yaml --profile v2-unstable up --build
```

- Start-up runs `docker build` for the `bundle` image and one
  `program-<template>` image per template before the port answers; a cold
  start takes several minutes under amd64 emulation.
- The ports are the `v2` profile's: client-v2 on `3000`, the server on
  `8080`, Postgres on `5432`. `PG_CLIENT_V2_PORT`, `PG_PORT`, and
  `PG_POSTGRES_PORT` move them, in the shell or the root `.env`, for example
  beside a running `v2` stack:

  ```sh
  PG_CLIENT_V2_PORT=3001 PG_PORT=8081 PG_POSTGRES_PORT=5433 \
    docker compose -f ../compose.yaml -p solana-playground-unstable --profile v2-unstable up --build
  ```

  A second stack needs its own `-p` project name: in the same project both
  profiles share `postgres`, `migrate`, and `wasm`, and the new ports recreate
  them under the running `v2` stack.
- `PG_SERVER_DIR` is the absolute path of another checkout's `server/`
  directory, for example a pull request's worktree. Its `templates/`
  replaces the image's whole, but start-up builds only the names in the
  image's `get_all_templates` (`server/src/templates/mod.rs`), with the
  image's settings for each: the Rust-side settings, `images/`, and `src/`
  stay the image's. A listed template that the mounted `templates/` lacks,
  for example one the pull request renames or re-versions, fails start-up;
  a directory the pull request adds is ignored. A path that does not exist
  makes `up` refuse. A changed
  `PG_SERVER_DIR` applies with `docker compose up -d server-unstable`,
  which recreates the container; `restart` keeps the old mount.
- `PG_DOCKER_GID` is the numeric group that owns the Docker socket inside a
  container: `0` on Docker Desktop and OrbStack, and on Linux the output of
  `stat -c %g /var/run/docker.sock`.
- client-v2 sends build and deploy to the unstable routes only with the
  `experimental.unstable` setting on. The profile sets
  `REACT_APP_SERVER_UNSTABLE=true`, which turns the setting on by default. A
  browser profile that already stored the setting keeps its value, as with
  `REACT_APP_SERVER_URL`; run this in the client's terminal to turn it on:

  ```sh
  setting set experimental.unstable true
  ```

  A Vercel build fails while `REACT_APP_SERVER_UNSTABLE=true`
  (`scripts/check-unstable-env.mjs`), because no hosted server serves
  `/unstable`. `yarn build` and the `v2-prod` profile keep the flag.

The client image builds from the primary checkout and from a linked worktree
alike: it reads no git data of the checkout, and `public/` comes in with the
build context.

## Deployment

For Vercel deployment instructions, see [Deploy client to Vercel](docs/deploy-client-vercel.md). Preview databases and their cleanup are in [Preview databases](docs/preview-databases.md), and the Neon path being retired in [Neon preview databases](docs/neon.md). Every doc in `docs/` is listed in [its index](docs/README.md).
