# Running CI locally with `act`

From the repository root, the `checks` job of `client-v2.yml` on the current tree:

```sh
cd client-v2 && act pull_request -C .. -W .github/workflows/client-v2.yml -j checks
```

On an arm64 host (Apple Silicon), the same with the arm64 overrides first:

```sh
cd client-v2 && act $(grep '^-' .arm64.actrc) pull_request -C .. -W .github/workflows/client-v2.yml -j checks
```

Config: [`client-v2/.actrc`](../.actrc) for an x86-64 host and [`client-v2/.arm64.actrc`](../.arm64.actrc) with the arm64 overrides. act reads `.actrc` from the directory it is launched in, hence the `cd`, and takes no flag for another file, so the overrides go on the command line, where they come after the file and win. `-C ..` points act at the workflows in the repository root. The `checks` job starts a Postgres service on 5432, so the compose Postgres is stopped for the run.

## Launching from a worktree

A linked worktree's `.git` is a pointer into the primary checkout, which act does not copy, and `generate-fast` copies `client/public` from the primary checkout too. Mount both, read-only, at their own paths. `--container-options` on the command line replaces the one in `.actrc`, so `--group-add 0` is repeated:

```sh
cd client-v2
main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
act $(grep '^-' .arm64.actrc) pull_request -C .. -W .github/workflows/client-v2.yml -j checks \
  --container-options "--group-add 0 -v $main/.git:$main/.git:ro -v $main/client/public:$main/client/public:ro"
```

Drop the `$(grep ...)` part on an x86-64 host.

## Other jobs

| Job | Command, from `client-v2` |
| --- | --- |
| `build` of `client-v2.yml` | `act pull_request -C .. -W .github/workflows/client-v2.yml -j build` |
| all of `ci.yml` | `act pull_request -C .. -W .github/workflows/ci.yml` |
| `cicd.yml` | `act workflow_dispatch -C .. -W .github/workflows/cicd.yml` |

`build` needs amd64 on every host, wasm-pack 0.10.3 ships no arm64 `wasm-opt`, so on an arm64 host run it without the overrides; the amd64 image is pulled once, and the job needs a clean tree. Without `-W`, `-j checks` also matches the `checks` jobs of `ci.yml` and `cicd.yml`.
