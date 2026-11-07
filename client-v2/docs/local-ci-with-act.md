# Running CI locally with `act`

Requires act 0.2.95 or later, with `--trust-project-actrc` on every command, as below. From 0.2.95, act ignores the flags of a project `.actrc` that reach the host (`--network host`, `--artifact-server-path`, `--container-options`) and leaves its `$HOME` unexpanded unless the command trusts the file. The flag works on the command line or in your user act config, never in `.actrc` itself. Without it the artifact server never starts, and an upload fails with `Unable to get the ACTIONS_RUNTIME_TOKEN env variable`.

**Run on the real wasm packages, `--input use-wasm-stubs=false`, unless the person you are running it for asks
for the stubs.** That is what `client-v2.yml` runs and every deployment ships; a run on the stubs leaves out the
`@real-wasm` specs and the bundle checks, so it can pass where CI fails. The stubs only save the wasm build, and
the commands below that use them are for a run where someone asked for exactly that. See
[On the real packages](#on-the-real-packages) for the command.

The jobs live in `reusable-client-v2.yml`, which `client-v2.yml` calls, so act runs that file with the
`workflow_call` event. From the repository root, its `checks` job on the current tree and the wasm stubs, when
the stubs were asked for:

```sh
cd client-v2 && act --trust-project-actrc workflow_call -C .. -W .github/workflows/reusable-client-v2.yml -j checks --input use-wasm-stubs=true
```

On an arm64 host (Apple Silicon), the same with the arm64 overrides first:

```sh
cd client-v2 && act --trust-project-actrc $(grep '^-' .arm64.actrc) workflow_call -C .. -W .github/workflows/reusable-client-v2.yml -j checks --input use-wasm-stubs=true
```

Config: [`client-v2/.actrc`](../.actrc) for an x86-64 host and [`client-v2/.arm64.actrc`](../.arm64.actrc) with the arm64 overrides. act reads `.actrc` from the directory it is launched in, hence the `cd`, and takes no flag for another file, so the overrides go on the command line, where they come after the file and win. `-C ..` points act at the workflows in the repository root. The `checks` job starts a Postgres service on 5432, so the compose Postgres is stopped for the run.

## Launching from a worktree

A linked worktree's `.git` is a pointer into the primary checkout, which act does not copy. Mount the primary checkout's `.git`, read-only, at its own path. `--container-options` on the command line replaces the one in `.actrc`, so `--group-add 0` is repeated:

```sh
cd client-v2
main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
act --trust-project-actrc $(grep '^-' .arm64.actrc) workflow_call -C .. -W .github/workflows/reusable-client-v2.yml -j checks --input use-wasm-stubs=true \
  --container-options "--group-add 0 -v $main/.git:$main/.git:ro"
```

Drop the `$(grep ...)` part on an x86-64 host.

## Other jobs

| Job | Command, from `client-v2` |
| --- | --- |
| `build` of `reusable-client-v2.yml` | `act --trust-project-actrc workflow_call -C .. -W .github/workflows/reusable-client-v2.yml -j build --input use-wasm-stubs=true` |
| all of `ci.yml` | `act --trust-project-actrc pull_request -C .. -W .github/workflows/ci.yml` |
| `cicd.yml` | `act --trust-project-actrc workflow_dispatch -C .. -W .github/workflows/cicd.yml` |

`--input use-wasm-stubs=true`, when the stubs were asked for, skips the `wasm` job, as `client-v2-with-stubs.yml` does, and no stub job runs `wasm-pack`, so the arm64 overrides apply. The input has no default: a run without it fails before any job starts. Without `-W`, `-j checks` also matches the `checks` jobs of `ci.yml` and `cicd.yml`.

## On the real packages

`--input use-wasm-stubs=false` runs the jobs as `client-v2.yml` does: the `wasm` job builds the six packages and the other jobs download them as the `wasm-pkg` artifact. The `wasm` job runs wasm-pack 0.10.3, which ships no arm64 `wasm-opt`, so this run keeps the amd64 of `.actrc` on every host: leave out the arm64 overrides. The amd64 image is pulled once.

```sh
cd client-v2
main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
act --trust-project-actrc workflow_call -C .. -W .github/workflows/reusable-client-v2.yml -j build --input use-wasm-stubs=false \
  --local-repository actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9=$HOME/.cache/act-local/upload-artifact-v4.6.2 \
  --local-repository actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a=$HOME/.cache/act-local/upload-artifact-v4.6.2 \
  --container-options "--group-add 0 -v $main/.git:$main/.git:ro"
```

One shard of the `e2e` job, here Firefox shard 1, with the same flags; `-j e2e` also runs the `wasm` job first:

```sh
act --trust-project-actrc workflow_call -C .. -W .github/workflows/reusable-client-v2.yml -j e2e \
  --input use-wasm-stubs=false --input firefox=true --matrix browser:firefox --matrix shard:1 \
  --env PORT=13999 \
  --local-repository actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9=$HOME/.cache/act-local/upload-artifact-v4.6.2 \
  --local-repository actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a=$HOME/.cache/act-local/upload-artifact-v4.6.2 \
  --container-options "--group-add 0 -v $main/.git:$main/.git:ro"
```

`--network host` (`.actrc`) puts the job's dev server on the host's ports, so `PORT` moves it off 3000 when a
local dev server holds that port. The browsers run under amd64 emulation, several times slower than a runner.

`-j build` runs the `wasm` job it needs first. act's artifact server, as of 0.2.95, cannot take an upload from the `upload-artifact` the workflows pin: v7 sends a `mime_type` field it rejects (`unknown field "mime_type"`), and v6's blob upload fails its signature check (`Error unauthorized`). The two `--local-repository` flags run both pinned commits from a v4.6.2 copy, which act accepts, while CI keeps v7; the pinned `download-artifact` v8 works as it is. Make the copy once:

```sh
git clone --branch v4.6.2 --depth 1 https://github.com/actions/upload-artifact ~/.cache/act-local/upload-artifact-v4.6.2
```

The build of the six packages took 18 min 52 s on an Apple Silicon host under amd64 emulation on 2026-11-03, with the cargo registry already cached; a later run restores them from act's cache.

The same checks of the `build` job without act, from `client-v2`:

```sh
yarn setup
REACT_APP_GA_MEASUREMENT_ID= yarn build-fast
yarn test-build
node scripts/wasm-stubs.mjs check-build build
```
