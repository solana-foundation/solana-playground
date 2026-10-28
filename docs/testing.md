# Testing plan

Manual checks that the playground builds, runs, and serves its assets. Each case lists preconditions, the command or
steps, and the expected result, so it can be run by hand and later scripted.

| Section | Covers |
| --- | --- |
| [Prerequisites](#0-prerequisites) | macOS and Docker set-up, toolchains, branches |
| [Builds](#1-builds) | wasm, client, client-v2 and its browser suite, server, compose images |
| [Client dev servers](#2-client-dev-servers-without-a-server) | client and client-v2 start with no build server running |
| [Full suite with compose](#3-full-suite-with-docker-compose) | client, server, and database together; client-server requests |
| [Static assets](#4-static-assets-default-rs-files-and-templates) | rust-analyzer `.rs` files in local, Vercel, and Docker builds; templates, tutorials |
| [Release gate](#5-release-gate-unstable-stays-out-of-production) | unstable stays out of production |
| [Optional: unstable server](#6-optional-unstable-server) | the server's unstable functionality, tested on purpose |
| [Parallel runs](#8-parallel-runs) | groups of cases run at once, on rotated ports |
| [client-v2 production build](#7-client-v2-production-build) | memory, the esbuild minifier, browser floor, type checks outside the build |
| [Default backend access](#9-default-backend-access) | `/api/agent` refuses every request without a session, from the browser and from `curl` |

Case IDs are stable: refer to a case by ID, not by position.

Every case states its success result under "Expect": what must be observed, not only that a command exits 0. Cases that
test a failure on purpose (C-2, C-3, C-5, M-4, G-2 to G-5) say so in their title or steps.

**Expected console messages.** These fail no case; C-1 and C-4 allow only the rows whose "Where" matches the run:

| Message | Where | Why |
| --- | --- | --- |
| A COEP error for the preview toolbar | Vercel previews | The toolbar's frame lacks the headers the page's COEP requires |
| A failed request for `manifest.json` | Vercel previews behind protection | The browser fetches the manifest without the bypass cookie |
| A `503` for `/api/auth/get-session` | client-v2 with no database or no sign-in configured locally (C-4, D-8) | The account endpoints need Postgres and the OAuth app |
| `ENOENT` for `/<project>/.workspace`, once, right after a project is created | client-v2 | The workspace folder is read before its first write (HOO-2150); it also shows in runs where everything else passes |

The browser's `ResizeObserver loop completed with undelivered notifications.` is not in the table: client-v2's global
error handler drops it (HOO-2125). A `logger:global` error with that text means the filter regressed, and C-4 fails.

## 0. Prerequisites

### P-1. Docker runs amd64 images

Every Docker image in this repository must run as `linux/amd64`: Anza does not publish ARM64 Solana releases, so an
ARM64 build of the server or program images fails.

- [ ] Docker has enough memory for parallel Rust builds (the client build alone sets `--max-old-space-size=6144`).
- [ ] `compose.yaml` pins `platform: linux/amd64` on its services, so `docker compose` needs nothing extra.

Darwin only (`uname -s` prints `Darwin`):

- [ ] Docker Desktop, Settings, General: "Use Rosetta for x86_64/amd64 emulation on Apple Silicon" is on. Without it
      Docker falls back to QEMU, which is several times slower for the Rust and Solana builds. OrbStack uses Rosetta
      without a setting.
- [ ] Any `docker build` or `docker run` outside compose gets the platform from the environment:

  ```sh
  [ "$(uname -s)" = Darwin ] && export DOCKER_DEFAULT_PLATFORM=linux/amd64
  ```

Run:

```sh
docker run --rm --platform linux/amd64 alpine uname -m
```

Expect: `x86_64`.

### P-2. Toolchains

- [ ] Node and yarn versions match `client/.nvmrc` and the `packageManager` field of `client/package.json`.
- [ ] `rustup` is installed. The wasm toolchain comes from `wasm/rust-toolchain.toml`.
- [ ] `git submodule update --init` has populated `client/public` (the assets submodule).

### P-3. Branches

- [ ] All cases run from a `master` checkout. Its `client/`, `server/`, and `wasm/` match upstream.

### P-4. One compose file, selected by profile

Every Docker case runs against the root [compose.yaml](../compose.yaml) and picks its services with `--profile`. A new
scenario adds a service or a profile to that file; it never adds a second compose file, an override file, or `-f`.

- [ ] `git ls-files | grep -iE '(^|/)(docker-)?compose[^/]*\.ya?ml$'` prints only `compose.yaml`.
- [ ] `docker compose config --profiles` lists every profile a case in this plan uses.

| Case | Profile |
| --- | --- |
| B-6, D-1, D-4, D-5, D-9 | `dev` |
| D-2, D-3 | `prod` |
| D-6 | `v2` |
| D-8, S-7 | `client-v2-standalone` |

The profiles for the upstream client (`client/`) stay in `compose.yaml` beside the client-v2 ones. A change for
client-v2 adds profiles; it does not rename or remove these:

| Profile | Runs |
| --- | --- |
| `dev` | client, server, database |
| `prod` | production build of the client, server, database |
| `client-standalone` | client without a server |
| `server-standalone` | server without a database |

- [ ] `docker compose config --profiles` lists all four.
- [ ] `docker compose --profile client-standalone config --services` includes `client-standalone` and no client-v2
      service.

### P-5. Docker builds run from a real checkout

The client Dockerfiles run `git submodule update --init client/public`, and `update-static.mjs` calls `git`. In a git
worktree, `.git` is a file that points to a path on the host (`gitdir: …/.git/worktrees/<name>`), which does not exist
in the image, so the build fails with `fatal: not a git repository`.

- [ ] Build images from the primary checkout or from a clone (`git clone --branch <branch> <worktree> <dir>`), never
      from a worktree under `.worktrees/`.

## 1. Builds

### B-1. wasm packages

The client depends on `wasm/*/pkg` as file dependencies, so this runs before any client install.

```sh
yarn --cwd client build-wasm
```

Expect: exit code 0; `ls wasm/*/pkg/*_bg.wasm` lists a compiled module for each wasm package.

### B-2. client: CI parity

Mirrors the `build` job in [reusable-checks.yml](../.github/workflows/reusable-checks.yml).

```sh
yarn --cwd client setup
git status --porcelain
yarn --cwd client test-types
yarn --cwd client test-unit
yarn --cwd client build
```

Expect: every command exits 0; `git status --porcelain` prints nothing (generated files are committed or ignored);
`client/build/index.html` exists.

### B-3. client-v2: CI parity

Mirrors the `checks` job in [client-v2.yml](../.github/workflows/client-v2.yml) and the `build` job in
[reusable-client-v2-build.yml](../.github/workflows/reusable-client-v2-build.yml).

Precondition: B-1, or `wasm/stub-packages.sh` as CI runs it. The stubs skip the Rust build but disable Rust
intellisense and the `solana`, `anchor`, `spl-token`, and `sugar` terminal commands, so S-3 needs B-1.

A checkout that started from the stubs keeps them after B-1: yarn 1 decides whether to copy a `file:` dependency from
the lockfile, not from the folder's content. Install with `--check-files` after B-1, and check that
`client-v2/node_modules/@solana-playground/rust-analyzer` holds `rust_analyzer_wasm_bg.wasm`, not only `index.js`.

```sh
yarn --cwd client-v2 install --frozen-lockfile
yarn --cwd client-v2 run check
yarn --cwd client-v2 build-fast
grep -q '\.flex{display:flex}' client-v2/build/static/css/main.*.css && echo tailwind ok
grep -q '"_PgConnection"' client-v2/build/static/js/*.js && grep -q '"_PgProgramInfo"' client-v2/build/static/js/*.js && echo names ok
yarn --cwd client-v2 test-build
```

Expect: exit code 0; `client-v2/build/index.html` exists; the two `grep` lines print `tailwind ok` and `names ok`, and
`test-build` passes, as the post-build steps "Check Tailwind is in the built CSS", "Check decorator class names survive
minification", and "Build tests" in `reusable-client-v2-build.yml` require. `run check` covers the in-source
collection test (`scripts/in-source-collection.test.mjs`, under `test-api`) and `test-build` the bundle checks, every
`client-v2/scripts/*.build-test.mjs`; M-5 to M-7 check the chunk scope, in-source test, module, and snapshot tests by
hand. Tests that need a database require `DATABASE_URL` and `yarn --cwd client-v2 db-migrate`.

### B-4. server: format, lint, release build

```sh
cargo +nightly fmt --manifest-path server/Cargo.toml --check
cargo clippy --manifest-path server/Cargo.toml --all-targets -- -D warnings
cargo build --manifest-path server/Cargo.toml --release
```

Expect: exit code 0 for each; `server/target/release/solpg-server` exists.

### B-5. client-v2: browser suite

Mirrors the `e2e` job in [client-v2.yml](../.github/workflows/client-v2.yml).

Precondition: the install of B-3, on the stubs or on B-1; a free slot port from "Slots" in
[Parallel runs](#8-parallel-runs), with no dev server on it, so the run starts its own. The suite needs no build
server, no Postgres, and no default backend: every spec answers the account and model endpoints with `page.route`.
`AGENT_API_KEY=` on the command empties what `client-v2/.env` would set, so the dev server reports no default
backend, as CI's does. With one configured, the panel opens with "Bring your own key" collapsed, and the specs that
fill that form without expanding it fail. The platform RPC variables in `client-v2/.env.local`
(`REACT_APP_DEVNET_RPC_URL` and the others) can stay set: the `test` fixture in
[e2e/fixtures.ts](../client-v2/e2e/fixtures.ts) starts every fresh profile on the public devnet, the endpoint the
specs stub, instead of the platform devnet those variables make the default.

```sh
k=5
PORT=$((13000 + 10 * k)) AGENT_API_KEY= E2E_FULL=1 yarn --cwd client-v2 test-e2e
grep -cv '^#\|^$' client-v2/e2e/known-skips.txt
```

Expect:

- [ ] the run ends with `N passed` and no `failed`.
- [ ] the run's `N skipped` equals the number the `grep` prints, less the entries whose `test.fixme` is gated on
      `process.env.CI`, which run locally. A skip beyond that count is one outside `e2e/known-skips.txt`. The job
      reads titles from the `json` reporter, which `playwright.config.mts` enables only in CI, so locally the count
      stands in for its "Check skips against the known list" step.
- [ ] no `flaky` in the summary. Outside CI `playwright.config.mts` sets no retries, so a test that fails on timing
      fails the run, which is where it gets fixed.
- [ ] the two `client-v2-ai` tests in `e2e/assistant-pause.e2e.spec.ts` pass rather than skip: they stub
      `/api/agent` themselves, so they need no configured backend.

### B-6. compose images

```sh
docker compose --profile dev build
```

Expect: the `client`, `server`, and `wasm` images build for `linux/amd64`. Verify with
`docker image inspect <image> --format '{{.Architecture}}'`, which prints `amd64`.

## 2. Client dev servers without a server

Goal: the client starts and stays usable when no build server is reachable. Only the actions that call the server fail.

Requests that need the server: `POST /build`, `GET /deploy/{uuid}`, `GET /share/{id}`, and `POST /new`. Nothing calls
the server on page load at `/`.

### C-1. client starts

Precondition: B-1 done; nothing listens on port 8080.

```sh
yarn --cwd client start
curl -sI http://localhost:3000
```

Expect:

- [ ] the page loads at `http://localhost:3000` with no console errors on load, apart from the "Expected console
      messages" whose "Where" matches the run.
- [ ] the IDE renders: file explorer, editor, and terminal. Typing `help` in the terminal lists the commands, which
      proves the wasm packages loaded.
- [ ] the network tab shows no failed request on load (no 4xx, 5xx, or HTML served for a non-HTML file), apart from
      `crates/core.rs`, `alloc.rs` and `std.rs`: upstream's client does not generate them (client-v2 does, see S-1).
- [ ] response headers include `Cross-Origin-Embedder-Policy: require-corp` and `Cross-Origin-Opener-Policy: same-origin`.
      The wasm packages need both.
- [ ] the editor opens a project; rust-analyzer completions work (see S-3); static assets are served (see S-10).

### C-2. client: actions that need the server fail cleanly

Steps: in the C-1 session, click Build, then Deploy, then Share.

Expect:

- [ ] each action shows an error in the terminal panel; the network tab shows a refused connection to
      `http://localhost:8080`. In a development build Build and Deploy target `/unstable/build` and `/unstable/deploy`;
      the connection fails before the path matters.
- [ ] the editor and terminal stay responsive after each error.

### C-3. client: share link route without a server

Steps: open `http://localhost:3000/<any-share-id>`.

Expect: an error page or message, not a blank screen.

### C-4. client-v2 starts

Precondition: `master`; nothing listens on port 8080.

client-v2 defaults its server endpoint to the remote Foundation server, not to `localhost`. To test the "no server"
case, point it at the local port:

```sh
REACT_APP_SERVER_URL=http://localhost:8080 yarn --cwd client-v2 dev
curl -s http://localhost:3000/api/health
```

Expect:

- [ ] the page loads at `http://localhost:3000`, and the C-1 checks for the console, the IDE, the terminal `help`, and
      the network tab pass.
- [ ] `/api/health` returns `200` (it is served by the client-v2 dev server, not the build server).
- [ ] the COEP and COOP headers from C-1 are present.
- [ ] S-10 passes against this server.

### C-5. client-v2: actions that need the server fail cleanly

Same steps and expectations as C-2, run against the C-4 session.

## 3. Full suite with Docker Compose

Precondition: P-1 done; port 3000 and 8080 free.

This section tests the stable server routes only; the unstable ones are [optional](#6-optional-unstable-server). The upstream client sends Build and
Deploy to `/unstable/*` in any build that is not a production build (`PgServer` in `client/src/utils/server.ts`), and
the compose server has no such routes, so its build and deploy cases run on the `prod` profile. client-v2 keeps the
`experimental.unstable` setting off by default, so the `v2` profile tests the stable routes.

### D-1. stack starts

```sh
docker compose --profile dev up --build
```

Expect:

- [ ] `wasm` exits 0; `db`, `server`, and `client` stay running.
- [ ] the server log shows it listening on 8080 with no MongoDB connection error.
- [ ] the client answers on `http://localhost:3000` (`PG_CLIENT_PORT` overrides the port), and the C-1 checks for
      the IDE, the terminal `help`, and the network tab pass.
- [ ] D-9 passes: the server builds a program.

### D-2. build a program

```sh
docker compose --profile prod up --build
```

Steps: open `http://localhost:3000`; in Settings, set "Build server URL" to Local (a production build defaults to
`https://api.solpg.io`); create an Anchor project and click Build.

Expect: `POST http://localhost:8080/build` returns 200 in the network tab, with no `/unstable/` in the path; the terminal
reports a successful build.

### D-3. deploy

Precondition: D-2 session; a wallet connected and funded on the selected cluster.

Steps: click Deploy.

Expect: `GET http://localhost:8080/deploy/{uuid}` returns 200; the terminal prints the program ID; `solana program show
<program ID>` in the playground terminal shows the program on the selected cluster.

### D-4. share round trip

Precondition: D-1 session (`dev` profile). A production build always sends share requests to `https://api.solpg.io`,
so only a development build exercises the local server here.

Steps: click Share, copy the link, open it in a new tab.

Expect: `POST /new` to `http://localhost:8080` returns an ID; `GET /share/{id}` returns the same files that were shared.

### D-5. CORS

```sh
curl -sI -X OPTIONS http://localhost:8080/build -H 'Origin: http://localhost:3000' -H 'Access-Control-Request-Method: POST'
curl -sI -X OPTIONS http://localhost:8080/build -H 'Origin: https://not-allowed.example' -H 'Access-Control-Request-Method: POST'
```

Expect: the first response carries `Access-Control-Allow-Origin`; the second does not. Allowed origins come from
`PG_CLIENT_URLS` and are prefix-matched.

### D-6. client-v2 stack

Precondition: `master`.

```sh
docker compose --profile v2 up --build
```

Steps: in Settings, check that `experimental.unstable` is off and set the server to Local (client-v2 defaults to the
remote Foundation server).

Expect: `client-v2` and `postgres` run; the D-2 to D-4 steps pass against the client-v2 UI, and no request path
contains `/unstable/`.

### D-8. client-v2 standalone container

Precondition: the `client-v2-standalone` profile in `compose.yaml`.

```sh
docker compose --profile client-v2-standalone up --build
docker compose exec client-v2-standalone sh -c 'command -v rustc cargo rustup'
```

Expect:

- [ ] the client answers on `http://localhost:3000` (`PG_CLIENT_V2_PORT` overrides the port) with no server running.
- [ ] the `exec` prints nothing and exits 127: the image ships the generated crate files, not the Rust toolchain.
- [ ] S-1, S-2, and S-10 pass against this container.

### D-9. the server builds a program, without a client

Precondition: D-1 session, or any profile that runs `server`. The request body is what `buildRust` in
`client/src/commands/build/build.ts` sends: `files` is a list of `[path, content]` pairs (`Files` in
`server/src/utils.rs`). The `/src/lib.rs` path form is taken from the client and is unverified.

```sh
jq -n --rawfile lib <path to a native program's lib.rs> '{files: [["/src/lib.rs", $lib]]}' > <run folder>/build.json
curl -s -X POST http://localhost:8080/build -H 'Content-Type: application/json' -d @<run folder>/build.json \
  > <run folder>/build-response.json
jq -r '.uuid' <run folder>/build-response.json
curl -s http://localhost:8080/deploy/<uuid> | head -c 4 | od -c
```

Use a minimal native program for `lib.rs`: `solana_program::entrypoint!` with a handler that returns `Ok(())`.

Expect:

- [ ] the build returns `200` with JSON: `uuid` is a string, `idl` is `null` (a native program), and `stderr` holds no
      `error`.
- [ ] `/deploy/<uuid>` returns the program binary: its first bytes print as `177   E   L   F`.

## 4. Static assets: default `.rs` files and templates

None of these come from the build server. The rust-analyzer files and tutorials are static files of the client
(`client/public`, mirrored into `client-v2/public`); framework templates are bundled into the client JavaScript.

A status of `200` alone proves nothing for a crate file: the single-page-app fallback answers a missing file with
`index.html` and `200`, and Rust Analyzer then panics with `Unexpected('<')`. Every crate check in section 4 also asserts
the body is not HTML.

The client-v2 requirements for these files are the spec `openspec/specs/client-v2-editor-crates/spec.md`. S-1 to S-3,
S-6 to S-9 and D-8 walk its manual scenarios.

Where client-v2's crate files come from. Every path writes them to `client-v2/public/crates`, and each generator skips
when its key file there matches its inputs:

| Path | Default crates (`core`, `alloc`, `std`) | Supported crates (`anchor_lang`, …) |
| --- | --- | --- |
| `yarn --cwd client-v2 generate` (`setup`, `build`, `start`) | `generate-default-crates.mjs` | `generate-crates.mjs` (`cargo fetch` first) |
| Vercel build (S-6) | `vercel-install.sh`: Build Cache, then Remote Cache, else generated | `yarn generate` in every build, no cache |
| Docker image build (S-7) | the crates step in `client-v2/Dockerfile` | the same step |
| `yarn dev`, `build-fast` (`generate-fast`) | not generated | not generated |

Run S-1 to S-3 against a dev server only after `yarn --cwd client-v2 generate`: `yarn dev` serves whatever an earlier
run left in `public/crates`.

### S-1. rust-analyzer default crates

```sh
curl -s http://localhost:3000/crates/core.rs | head -c 200
curl -s http://localhost:3000/crates/alloc.rs | head -c 200
curl -s http://localhost:3000/crates/std.rs | head -c 200
```

Expect: Rust source for each, not `<!doctype html>`.

### S-2. rust-analyzer supported crates

```sh
curl -s http://localhost:3000/crates/anchor_lang.rs | head -c 200
curl -s http://localhost:3000/crates/anchor_lang.toml | head -c 200
```

Expect: Rust source and TOML, not HTML. The same holds for every crate in [supported-crates.json](../supported-crates.json)
and its proc-macro dependencies, named in snake case, except `mpl-token-metadata`.

Every supported crate at once. The list comes from the served `versions.json`; the header is ignored outside Vercel, so
the loop runs unchanged against any `base`:

```sh
base=http://localhost:3000
n=0
for c in $(curl -s -H "x-vercel-protection-bypass: ${VERCEL_BYPASS:-}" "$base/crates/versions.json" \
  | jq -r 'keys[] | select(. != "mpl-token-metadata") | gsub("-"; "_")'); do
  for f in "$c.rs" "$c.toml"; do
    n=$((n+1))
    body=$(curl -s -H "x-vercel-protection-bypass: ${VERCEL_BYPASS:-}" "$base/crates/$f" | head -c 100)
    case "$body" in ''|'<'*) echo "BAD $f";; esac
  done
done
echo "checked $n"
```

Expect: no `BAD` line; `checked` counts two files per supported crate (54 at `f94b845a`). The loop does not cover the
proc-macro dependencies, which `versions.json` does not list.

### S-3. rust-analyzer in the editor

Precondition: real wasm packages (B-1), not the stubs.

Steps: create an Anchor project and open `src/lib.rs`, then:

1. open the browser console;
2. type `let v = Vec::` and ask for completion;
3. write `std::array::from_fn`;
4. type `Pubkey::find_` and ask for completion;
5. hover over `Context`, `Account`, and `Signer`;
6. look at `declare_id!` in `src/lib.rs`;
7. add `src/a.rs` with `pub struct A;` and `src/b.rs` with `pub struct B;`, then add `mod a; mod b;` and
   `use a::A; use b::B;` to `src/lib.rs`.

Expect:

- [ ] no Rust Analyzer panic in the console, such as `Parse(Error { … Unexpected('<') … })` from `world_state.rs`.
- [ ] `Vec::` offers `capacity` and `clear`.
- [ ] `std::array::from_fn` resolves (stabilized in Rust 1.63, so it proves the default crates are not older).
- [ ] `Pubkey::find_` offers `find_program_address` with its signature and documentation.
- [ ] each hover shows the definition.
- [ ] `declare_id!` carries no "unresolved macro" diagnostic, which proves the proc-macro crates in
  `/crates/transitive.json` loaded.
- [ ] neither import is underlined. Two files besides `lib.rs` are needed: each must get a file id of its own.

Known limitation: a crate outside `supported-crates.json`, such as `clockwork_sdk` in some tutorials, has no crate
file, so its imports stay unresolved. This is not a regression.

To prove the completions come from the generated files: move `client-v2/public/crates/{core,alloc,std}.rs` aside,
reload, and repeat steps 2 and 3. Expect only plain word suggestions from the open file, no `capacity` and no
`from_fn`. Move the files back.

### S-4. framework templates

Steps: create a new project for each framework: Anchor, Native, and Seahorse.

Expect: each project opens with the files from `client/src/frameworks/<framework>/files`; D-2 builds each one when the
server is running.

### S-5. tutorials

Steps: open `/tutorials`, open `bank-simulator` (a Markdown tutorial), open its first page.

```sh
curl -s -o /dev/null -w '%{http_code} %{content_type}\n' http://localhost:3000/tutorials/bank-simulator/content.json
```

Expect: the content renders; the `curl` prints `200 application/json` (the file is generated by `yarn generate`). A
`text/html` type means the single-page-app fallback answered. Custom tutorials such as `hello-anchor` have no
`content.json`, so they always get the fallback; do not pick one here.

### S-6. crate files in a Vercel build

Precondition: a preview deployment of a branch with `generate-default-crates.mjs`; the Vercel CLI version pinned as
`VERCEL_CLI` in `client-v2/Makefile.vercel`; a Protection Bypass for Automation secret from the project settings in
`VERCEL_BYPASS` (never in this file); the Vercel team slug in `VERCEL_SCOPE`.

```sh
npx vercel@<version> inspect <deployment URL> --logs --scope "$VERCEL_SCOPE" \
  | grep -E 'default crates:|Default crates are current|Crates are current|generate-crates|not found'
curl -s -H "x-vercel-protection-bypass: $VERCEL_BYPASS" <deployment URL>/crates/std.rs | head -c 200
curl -s -H "x-vercel-protection-bypass: $VERCEL_BYPASS" <deployment URL>/crates/anchor_lang.toml | head -c 200
```

Expect:

- [ ] the install log shows `default crates: HIT in Build Cache`, `HIT in Remote Cache`, or `MISS … generating`
      followed by `core`, `alloc`, and `std`.
- [ ] the `yarn generate` log shows `Default crates are current … Skipping...`.
- [ ] the S-2 loop, with `base=<deployment URL>`, prints no `BAD` line. The log cannot prove every supported crate:
      `generate-packages` prints lines that match the same `grep`.
- [ ] no line contains `not found`: `generate-crates.mjs` fails the build on a missing supported crate.
- [ ] both `curl`s print Rust source and TOML, not `<!doctype html>`.
- [ ] S-3 passes on the preview (open it once with `?x-vercel-protection-bypass=<secret>&x-vercel-set-bypass-cookie=true`).

A miss on the default crates adds about 2 minutes to the build; a hit adds none. The supported crates add about
20–30 seconds to every build.

### S-7. crate files in a Docker image build

Precondition: P-5.

```sh
docker compose --profile client-v2-standalone build --progress=plain 2>&1 \
  | grep -E "name: '(core|alloc|std|anchor-lang)'|Could not find Rust|not found"
docker compose --profile client-v2-standalone up -d
docker compose logs client-v2-standalone | grep -E 'Default crates are current|Crates are current'
docker compose exec client-v2-standalone sh -c 'ls public/crates/core.rs public/crates/.default-crates-key public/crates/.crates-key'
```

Expect:

- [ ] the image build generates `core`, `alloc`, `std`, and the supported crates, and prints neither
      `Could not find Rust` nor `not found`.
- [ ] at start, both generators report their crates current and skip.
- [ ] the three files exist in the container; D-8's `exec` prints nothing.

### S-8. crate files are the same everywhere

Precondition: S-6 and S-7 run on the same commit; `yarn --cwd client-v2 generate` run locally on it.

```sh
for f in core.rs alloc.rs std.rs core.rs.br anchor_lang.rs anchor_lang.toml versions.json; do
  echo "$f local=$(shasum -a 256 client-v2/public/crates/$f | cut -c1-16)" \
    "vercel=$(curl -s -H "x-vercel-protection-bypass: $VERCEL_BYPASS" <deployment URL>/crates/$f | shasum -a 256 | cut -c1-16)" \
    "docker=$(curl -s http://localhost:3000/crates/$f | shasum -a 256 | cut -c1-16)"
done
```

Expect: the three hashes agree on every line. The generators pin their inputs (the toolchain in
`wasm/rust-analyzer/rust-toolchain.toml`, the `syn-file-expand-cli` versions, `server/programs/Cargo.lock`, and the
brotli version bundled with Node), so macOS, Vercel's builder, and the Docker image produce the same bytes.

### S-9. crate generators locally

Precondition: Node from `client-v2/.nvmrc` (`generate-default-crates.mjs` refuses another major); `rustup` installed.
An empty `CARGO_HOME` reproduces a fresh machine and Vercel's builder; use a folder of your own, not `/tmp`.

```sh
export CARGO_HOME=<empty folder>
rm -f client-v2/public/crates/.crates-key client-v2/public/crates/.default-crates-key
yarn --cwd client-v2 generate-default-crates
yarn --cwd client-v2 generate-crates
ls client-v2/public/crates/{core,alloc,std}.rs* client-v2/public/crates/.default-crates-key
yarn --cwd client-v2 generate-default-crates
yarn --cwd client-v2 generate-crates
```

Expect:

- [ ] the first `generate-default-crates` prints `core`, `alloc`, and `std` with their toolchain, Node, and brotli
      versions; the first `generate-crates` runs `cargo fetch`, then prints every supported crate and never `not found`.
- [ ] the `ls` lists all seven default-crate files (`core.rs`, `alloc.rs`, `std.rs`, their `.rs.br` copies, and
      `.default-crates-key`): `generate-crates` empties `public/crates` but keeps them.
- [ ] the second runs print `Default crates are current … Skipping...` and `Crates are current … Skipping...`.

If the first `generate-default-crates` stops with `rustup is not installed at …`, the branch predates
`--no-self-update` in `generate-default-crates.mjs`: rustup's self-update check fails when `CARGO_HOME` does not hold
rustup.

A changed input regenerates. Run `yarn --cwd client-v2 generate-default-crates --key`, change `channel` in
`wasm/rust-analyzer/rust-toolchain.toml`, and run it again: the key differs, and the generator runs instead of
skipping. Restore the file.

### S-10. static assets

The assets come from the `client/public` submodule (mirrored into `client-v2/public`). The paths in the S-10 command are one
file per folder; if the submodule renames one, pick another file from the same folder.

```sh
for p in fonts/JetBrainsMono.woff2 icons/sidebar/build.png themes/dracula.json frameworks/anchor/icon.png \
  languages/rust/grammar.tmLanguage.json packages/versions.json manifest.json; do
  curl -s -o /dev/null -w "%{http_code} %{content_type} $p\n" "http://localhost:3000/$p"
done
```

Expect: `200` and a content type other than `text/html` for every path. `/packages/versions.json` is generated by
`yarn generate`; an HTML response for it means the generate step did not run.

## 5. Release gate: unstable stays out of production

The server's unstable functionality must not reach production until it is tested on its own. Run these before every
production deploy of the server or the clients. A failure blocks the deploy.

### R-1. production server image builds without unstable

App Engine deploys the server from [server/Dockerfile](../server/Dockerfile) (`deploy_server` in
[cicd.yml](../.github/workflows/cicd.yml)).

```sh
grep -n 'unstable' server/Dockerfile server/app.yaml .github/workflows/cicd.yml
grep -n -A3 '^\[features\]' server/Cargo.toml
```

Expect: the first command prints nothing; `[features]` has no `default` entry that includes `unstable`.

### R-2. deployed server has no unstable routes

```sh
curl -s -o /dev/null -w '%{http_code}\n' -X POST <production server URL>/unstable/build
curl -s -o /dev/null -w '%{http_code}\n' -X POST <production server URL>/build
```

The production server URL is `FOUNDATION_ENDPOINT` in `client-v2/src/settings/server/default-endpoint.ts`.

Expect: `404` for `/unstable/build`; anything but `404` for `/build`, which proves the URL is right.

### R-3. production clients use the stable routes

- [ ] client-v2: `experimental.unstable` defaults to `false`. `src/settings/experimental/experimental.test.ts` guards
      this, so B-3 covers it.
- [ ] upstream client: a production build sends Build and Deploy to the stable routes (`PgServer` in
      `client/src/utils/server.ts`); D-2 covers it.

## 6. Optional: unstable server

Run these only when testing the unstable functionality on purpose. They never gate a release; section 5 does.

The compose `server` image is built without `--features unstable` and has no `docker` binary, so no profile runs the
unstable server. It runs as a native binary instead. This is the one exception to P-4.

### U-1. unstable build

```sh
cargo build --manifest-path server/Cargo.toml --release --features unstable
```

Expect: exit code 0; binaries `solpg-server`, `build-program`, and `bundle` in `server/target/release/`.

### U-2. unstable routes

Precondition: U-1 done; the P-1 Darwin export in the same shell; MongoDB reachable at `PG_DB_URI` (the compose `db`
service publishes no port).

```sh
PG_PORT=8081 server/target/release/solpg-server
```

Run it from `server/` so it finds `templates/` and `images/`. `PG_PORT` avoids a clash with the compose server.

Steps: point a client at `http://localhost:8081`; in client-v2, turn `experimental.unstable` on. Build a program, then
bundle a package.

Expect:

- [ ] start-up builds one `program-<template>` image per directory in `server/templates/` and a bundle image. A cold
      build takes several minutes.
- [ ] `POST /unstable/build` and `POST /unstable/bundle` return 200.

Known issue: `sandbox.rs` clears the environment before `docker exec`, which drops `PATH`; on macOS the bundle route
then fails with "No such file or directory". Linux is unaffected.

### U-3. sandbox templates

Precondition: U-2 server running.

```sh
docker images --format '{{.Repository}}' --filter 'reference=program-*'
```

Expect: one image per directory in `server/templates/`.

## 7. client-v2 production build

The production build minifies with esbuild through `terser-webpack-plugin`'s `esbuildMinify`; the Terser library does
not run. It also leaves the type check and ESLint to CI and `yarn run check`. The requirements are the spec
`openspec/specs/client-v2-build/spec.md`; M-1 to M-7 walk its manual scenarios.
The bundle is about 15% larger than Terser's, accepted on purpose; shrinking it is a postponed improvement.

### M-1. the build fits Vercel's standard machine

Steps: in the Vercel dashboard, redeploy a preview with "Use existing Build Cache" unticked.

Expect:

- [ ] the log shows `Skipping build cache` and `Build machine configuration: 4 cores, 8 GB`.
- [ ] `Compiled successfully.` and no "Out of Memory" event in the build system report.

Locally, a cold `yarn --cwd client-v2 build` with `NODE_OPTIONS='--max-old-space-size=6144'` peaked at about 4.5 GB
summed over its processes (Terser had peaked at 9.6 GB). `/usr/bin/time -l` reports one process only, so sample the
sum to compare.

### M-2. decorator class names survive minification

```sh
yarn --cwd client-v2 build-fast
grep -l '"_PgConnection"' client-v2/build/static/js/*.js
grep -l '"_PgProgramInfo"' client-v2/build/static/js/*.js
```

Expect:

- [ ] each `grep` lists a file. CI runs the same check after `build-fast` ("Check decorator class names survive
      minification" in `reusable-client-v2-build.yml`) and fails without them.
- [ ] on a production build (a preview, or `serve -s client-v2/build`), change the endpoint in Settings from Devnet to
      Testnet: the cluster label in the bottom bar changes to Testnet, and the tab does not freeze (the terminal still
      answers `help`). Decorators name change events after
      `_Pg*` classes; two classes minified to the same name loop forever, in production builds only.

### M-3. minified output stays within the browser floor

```sh
NODE_ENV=production node -e 'const {createWebpackProdConfig}=require("@craco/craco"); console.log(createWebpackProdConfig(require("./craco.config.js")).optimization.minimizer[0].options.minimizer.options.target)'
```

Run from `client-v2/`.

Expect:

- [ ] the target lists the lowest version per browser of the `browserslist` in `client-v2/package.json`
      (`chrome111`, `edge111`, `firefox128`, `opera97`, `safari16.4` at `bf729fa1`).
- [ ] optional, where a Safari 16.4 device is available: the production build loads every JavaScript chunk with no
      syntax error in the console. The `browserslist` target check is the gate; this step only confirms it.

### M-4. type checks and lint run outside the build

Steps: add a type error to a bundled file, for example `export const probe: number = "x";` at the end of
`client-v2/src/utils/connection.ts`.

Expect:

- [ ] `yarn --cwd client-v2 build-fast` still completes.
- [ ] `yarn --cwd client-v2 test-types` and `yarn --cwd client-v2 run check` fail at `tsc --noEmit`. Use `run`: yarn
      1's built-in `check` shadows the script.
- [ ] with `git config core.hooksPath .githooks`, a push stops at the pre-push hook.
- [ ] `yarn --cwd client-v2 dev` shows the error in the overlay.

Remove the type error.

### M-5. chunks declare nothing at the top level

```sh
yarn --cwd client-v2 build-fast
yarn --cwd client-v2 test-build
```

`test-build` runs `chunk-scope.build-test.mjs` over `client-v2/build/static/js`, the chunks that ship; CI runs it
after the production build, in `reusable-client-v2-build.yml`. `top-level-declaration.test.mjs`, in `test-api`, covers
the parser it uses.

Expect:

- [ ] `test-build` passes.
- [ ] with `format: "iife"` removed from `esbuildMinifyOptions` in `client-v2/scripts/esbuild-minify.mjs`, a rebuild
      and `test-build` fail and name the identifier a chunk declares at the top level. Chunks load as classic scripts,
      so their top-level helpers are globals and a later chunk's same-named helper overwrites them. Restore the option.
- [ ] `test-build` without a `client-v2/build/` fails instead of passing.

### M-6. in-source tests stay out of the bundle

```sh
yarn --cwd client-v2 build-fast
yarn --cwd client-v2 test-build
```

Expect:

- [ ] `test-build` passes: `scripts/in-source-tests.build-test.mjs` collects every `it` title from the in-source
      blocks under `client-v2/src` (`client-v2/AGENTS.md`, "Tests: a module's unit tests live in the module") and
      finds none of them in `client-v2/build/static/js`. webpack drops the block on its own, with no setting of ours,
      which is why the outcome is checked.
- [ ] a planted leak makes it fail naming the chunk and the title: copy a block's title into a production string,
      rebuild, and run `test-build` again; the failure reads `<chunk> holds "<title>" from <module>`. Revert the plant.
      A test helper imported by production code carries no title; M-7 plants that case.
- [ ] with `yarn --cwd client-v2 dev` running, the served `static/js/bundle.js` holds none of that module's test
      titles either.

### M-7. the bundle snapshot is current and carries no test code

```sh
REACT_APP_GA_MEASUREMENT_ID= yarn --cwd client-v2 build-fast
yarn --cwd client-v2 test-build
yarn --cwd client-v2 bundle:info
git -C client-v2 diff --exit-code -- bench/BUNDLE.md
```

Run it on a branch rebased onto its base. CI's build has no GA id, and the empty `REACT_APP_GA_MEASUREMENT_ID` keeps
CRA from taking one from `client-v2/.env` (dotenv does not override a variable already set). Sentry stays out of a build without `VERCEL_ENV` (`sentryEnabled` in
`client-v2/scripts/sentry-gate.mjs`). `build-fast` writes `client-v2/bundle-info/bundle-modules.json`, outside `build/` so no deployment serves it: the
module list `BundleModulesPlugin` in `client-v2/craco.config.js` takes from webpack. `test-build` runs
`scripts/bundle-modules.build-test.mjs` over that list and `scripts/bundle-info.build-test.mjs` against
`client-v2/bench/BUNDLE.md`. The pure functions behind both (`scripts/lib/bundle/snapshot.test.mjs`, `diff.test.mjs`,
`modules.test.mjs`) and the comment workflow's pull request lookup (`locate-pr.test.mjs`) run under `test-api`.

Expect:

- [ ] `test-build` passes, and `bundle:info` leaves `bench/BUNDLE.md` unchanged: the `git diff` exits 0.
- [ ] `client-v2/build/` holds no `bundle-modules.json`.
- [ ] a planted test helper makes `bundle-modules.build-test.mjs` fail naming it: add
      `import { storedValues } from "@/test-utils/stored-values";` and `console.log(storedValues(localStorage));` to
      `client-v2/src/index.tsx`, rebuild, and run `test-build`; the failure lists `./src/test-utils/stored-values.ts`.
      The call matters: webpack drops a bare `import "...";` of a module with no side effects, and nothing ships.
      Revert the plant and rebuild.
- [ ] a stale snapshot makes `bundle-info.build-test.mjs` fail naming `yarn bundle:info` and the row: raise the
      `main` row's gzipped cell in `bench/BUNDLE.md` by 30 kB and run `test-build`. Restore the file.
- [ ] `test-build` without a `client-v2/build/` fails instead of passing.
- [ ] on a pull request to `master`, the build job's "Bundle change report" step summary holds the report, and one
      comment headed "Bundle change vs `master`" appears on the pull request, naming the pull request's head commit
      under the heading; a second push updates the same comment. `workflow_run` runs the workflow from the default
      branch, so the comment appears only once `bundle-info-comment.yml` is on `master`.
- [ ] "A pull request with a stale snapshot": push a commit that changes `bench/BUNDLE.md` as in the stale-snapshot
      step. "Build tests" fails, and the comment is still posted with the line saying `client-v2/bench/BUNDLE.md` is
      out of date for this branch.
- [ ] "A pull request with no size change": on a pull request that changes no bundle size, the comment says
      "No row moved past the 11 KiB tolerance." and holds the fresh tables in a collapsed "Full table (fresh build)"
      section.
- [ ] a pull request from a fork gets the comment as well. Check it on a real fork pull request after this workflow
      is on `master`, and mark the step with the pull request's number.

## 8. Parallel runs

Precondition: `compose.yaml` from branch `chore/compose-parallel-runs`. It names every built image, so a run under
another `COMPOSE_PROJECT_NAME` reuses the images instead of rebuilding them, and it passes
`REACT_APP_SERVER_URL=http://localhost:${PG_PORT}` to the clients that run with a server, so a client follows its
server's port. Without it, every client calls port 8080, and D-2 and D-6 need the server set to Local by hand.

A run is a group of cases that share one stack. Each group gets its own project name and its own ports; containers,
networks, and volumes, including the databases, are separate per project. Browser storage is separate too, because a
different port is a different origin.

### Order

1. Serial: B-6 builds every image once, from one clone (P-5).
2. Parallel: the groups listed under "Groups", each with `up --no-build`.
3. Serial: S-8, which compares the results of S-6 and S-7.

### Groups

| Group | Cases | Profile | Slot |
| --- | --- | --- | --- |
| upstream dev | D-1, D-4, D-5, D-9, C-3 | `dev` | 1 |
| upstream prod | D-2, then D-3 | `prod` | 2 |
| v2 stack | D-6 | `v2` | 3 |
| v2 standalone | D-8, S-7, S-1 to S-3, S-10 | `client-v2-standalone` | 4 |
| local, no Docker | B-5, C-1, C-2, C-4, C-5, S-9 | none | `PORT` per dev server, from slot 5 |
| remote | S-6, R-2 | none | none |

### Slots

Slot `k` publishes the client on `13000 + 10k`, the server on `13001 + 10k`, and Postgres on `13002 + 10k`. The range
leaves the default ports (3000, 8080, and 5432) free for a developer's own stack.

```sh
k=1
COMPOSE_PROJECT_NAME=pg-slot$k PG_CLIENT_PORT=$((13000 + 10 * k)) PG_CLIENT_V2_PORT=$((13000 + 10 * k)) \
  PG_PORT=$((13001 + 10 * k)) PG_POSTGRES_PORT=$((13002 + 10 * k)) \
  docker compose --profile dev up --no-build -d
```

In each case of a group, read `http://localhost:3000` and `http://localhost:8080` as the slot's client and server ports.

client-v2's browser suite does not take one of these slots: leave `PORT` unset and run only the specs you touched.

```sh
yarn test-e2e e2e/<spec>.e2e.spec.ts
```

A local run waits in a machine-wide queue, so several worktrees do not swap the machine, and the queue picks its port:
queue slot `N` runs on `13900 + N`, so the 139xx range is the queue's and no group above uses it. At most
`E2E_MAX_RUNS` runs (default 1) go at once, each with `E2E_WORKERS` Chromiums (default 2). The queue's slots are the
directories `slot-1`, `slot-2`, ... under `~/.cache/solana-playground-e2e` (`E2E_QUEUE_DIR` moves them); each one's
`owner.json` names the run's pid, worktree, and port. A waiting run prints who holds the slots. A run that was killed
leaves its slot behind, and the next run reclaims it once the owner's pid is gone. If an unrelated process has since
been given that pid, the slot stays held until that process exits: when a run waits on a holder that is not an e2e run,
delete the slot by hand (`rm -r ~/.cache/solana-playground-e2e/slot-N`). CI does not queue and uses port 3000.

The run starts its own dev server on its port, or reuses one that this worktree already started there. A server on the
port from another worktree, or anything else that is not this worktree's client-v2, fails the run before any test, and
the message names the pid holding the port. On a queue port that holder can only be a dev server left behind by a run
that was killed (its slot was reclaimed, its server was not): stop it and run again. A hand-set `PORT` still works,
outside 139xx, and gets the same check.

A spec that fails on the runner and passes on a laptop is usually a timing race. `E2E_CPU_THROTTLE=<n>` slows each
test's `page` `n` times through CDP, and `--repeat-each` with more `E2E_WORKERS` adds load, so the race shows locally:
`E2E_WORKERS=4 E2E_CPU_THROTTLE=6 yarn test-e2e e2e/<spec>.e2e.spec.ts --repeat-each 10`. It reaches only specs that
import `test` from `e2e/fixtures.ts`, and in them only the `page` fixture: a page the test opens itself runs at full
speed.

The full suite is CI's. A local run with no spec, or with a filter that names the test directory (`e2e/`, `.`), stops
with a message; a `--grep`, `--only-changed`, `--test-list`, or `--ui` run goes ahead, and so does `--last-failed` once
a last run's record exists (without one it runs everything). `E2E_FULL=1 yarn test-e2e` runs the full suite anyway,
still through the queue. The check reads filters as paths, while Playwright reads them as regular expressions, so a
broad pattern such as `spec` gets past it: it catches the usual mistake, not every spelling.

### Limits

- [ ] Every group runs from its own clone: B-1 to B-5, the C cases, and S-9 write to `node_modules`, `public/`,
      `target/`, `test-results/`, and `public/crates`. A worktree does not work for Docker builds (P-5).
- [ ] Images are shared by name, so all groups test the commit B-6 built. Testing two commits at once needs two
      separate image builds, one after the other.
- [ ] Run serially what shares global state: U-1 to U-3 (globally named `program-*` images) and D-3 (one funded
      wallet).
- [ ] Start no more groups than Docker's memory allows: each client container runs a CRA dev server or build of
      several GB, and emulation adds to it.
- [ ] Stop each group with `docker compose -p pg-slot<k> down -v` so its volumes go with it.

## 9. Default backend access

`POST /api/agent` spends the deployment's paid model key, so it answers only a user signed in with GitHub, on the
deployment's own origin. No request without a session reaches the upstream: not from the panel, and not from `curl`
or any other HTTP client. The answers are listed in
[Assistant default backend](../client-v2/docs/deploy-client-vercel.md#assistant-default-backend).

Precondition, local: `yarn --cwd client-v2 dev` with sign-in configured (`SIGN_IN_ENV` in
`client-v2/src/features/auth/config.mjs`), a migrated Postgres, `AUTH_BASE_URL=http://localhost:3000`, and
`AGENT_API_KEY` set. A placeholder key is enough for every case: a turn that passes the gate reaches the upstream and
comes back as the upstream's own refusal, which spends nothing. Against a deployment, read `http://localhost:3000` as
its origin.

A turn's body, used by every case:

```sh
TURN='{"messages":[{"role":"user","content":"hi"}]}'
```

### G-1. the probe reports the backend only with sign-in

```sh
curl -s http://localhost:3000/api/agent
```

Expect: `{"configured":true,"model":"…"}`. Restart the dev server without `GITHUB_CLIENT_ID`: the same request answers
`{"configured":false,"model":null}`.

### G-2. a request without a session is refused, from any client

```sh
curl -s -i -X POST http://localhost:3000/api/agent -H 'content-type: application/json' -d "$TURN"
```

Expect: `401` with `{"error":"Sign in with GitHub to use the default backend.","reason":"signed-out"}`. The same with
`-H 'origin: http://localhost:3000'`, and with `-H 'content-type: text/plain'`.

### G-3. a forged session is refused

```sh
curl -s -i -X POST http://localhost:3000/api/agent -H 'content-type: application/json' \
  -H 'cookie: better-auth.session_token=forged.value' -d "$TURN"
```

Expect: `401` with `reason: "signed-out"`.

### G-4. a request from another site is refused, signed in or not

```sh
curl -s -i -X POST http://localhost:3000/api/agent -H 'content-type: text/plain' \
  -H 'origin: https://evil.example' -d "$TURN"
```

Expect: `403` with `{"error":"Cross-origin request refused"}`. The same with a valid session cookie from G-6.

### G-5. sign-in not configured refuses every same-origin turn

Restart the dev server without `GITHUB_CLIENT_ID`, then run the G-2 request. A second dev server on another port
works too, with `PORT` and `AUTH_BASE_URL` set to that port. A cross-origin request still answers G-4's `403`: the
origin check runs first.

Expect: `503` with `{"error":"Sign-in is not configured on this deployment, so its default backend is off. Pick another
backend and supply your own key."}`.

### G-6. the browser, signed out and signed in

Signed out:

- [ ] Send a message in the assistant panel (or open More, then Connect a model): Connect a model opens, its Default
      backend carries the tag "sign-in needed" and the description "Sign in with GitHub to use it, or bring your own
      key below.", and its button reads **Sign in with GitHub**, not **Start**. The prompt stays in the composer.
- [ ] In the browser console, a turn from the page itself is refused:

  ```js
  const r = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }) });
  [r.status, await r.json()]
  ```

  Expect: `401` with `reason: "signed-out"`.

Signed in with GitHub. This half needs a real GitHub OAuth app whose callback is `AUTH_BASE_URL`; placeholder
`GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` values cover only the signed-out half.

- [ ] After a reload, wait until `/api/auth/get-session` has answered in the network tab: until then the panel shows the
      signed-out state. Then a send connects the default, and in Connect a model Default carries "no key needed" and the
      button reads **Start**.
- [ ] The same console request passes the gate: the body has no `reason`. With a placeholder key the status is still
      `401`, from the upstream, and the body reads `Upstream 401: …`.
- [ ] Copy the `better-auth.session_token` cookie from the browser's devtools into G-2's request as
      `-H 'cookie: better-auth.session_token=<value>'`, URL-encoded as devtools shows it or decoded: it passes the
      gate too, and G-4 with the same cookie still answers `403`.

### G-7. a deployment

Run G-1 to G-4 against a preview or production origin, then the rules in
[Firewall](../client-v2/docs/firewall.md#verifying).

Expect: the same answers as locally, and `429` once a loop passes the `/api/agent` rate limit.
