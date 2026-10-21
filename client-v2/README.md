## Client

This is the main application of Solana Playground.

## Setup

`wasm/*/pkg` and `public/` are both gitignored, so a fresh clone or a new
worktree has never built them. `yarn install` cannot resolve the local `file:`
dependencies until `wasm/*/pkg` exists.

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
once. A `CARGO_TARGET_DIR` set by the user turns the copy off. It then clears
`node_modules` (all but `.cache`) and installs, because yarn 1 copies a local
`file:` package again only when its folder is missing, and an install over an
old tree can keep a hoisting the lockfile no longer describes.

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
which clears `node_modules` first so it takes the new packages), copies
`public/` from the assets submodule, generates the crate, package and tutorial
data, and bundles the app into `build/`. A first run takes about an hour;
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

### Static assets and worktrees

`public/` is mirrored from the `client/public` submodule, and `yarn start` /
`yarn build` refresh it automatically. Run `make update-static` by hand only
after bumping that submodule to change asset content.

Worktrees are supported: the mirror is always copied from the _primary_
checkout, so a worktree never initialises a submodule of its own. (A submodule's
git dir is shared via `.git/modules`, so initialising one in a second worktree
detaches it in the first — which is why `public/` is not a submodule here.)

## Docker

Run client-v2 together with the build server via [Docker Compose](https://github.com/docker/compose):

```sh
docker compose -f ../compose.yaml --profile v2 up --build
```

The client is served on `http://localhost:3000` (override with
`PG_CLIENT_V2_PORT`) and the build server on `http://localhost:8080`.

For a production build served statically, use the `v2-prod` profile instead.

The `dev`, `prod` and `client-standalone` profiles build the upstream `client/`,
not this one. See the [root README](../README.md#run-with-docker).

## Deployment

For Vercel deployment instructions, see [Deploy client to Vercel](docs/deploy-client-vercel.md). Preview databases and their cleanup are in [Neon preview databases](docs/neon.md). Every doc in `docs/` is listed in [its index](docs/README.md).
