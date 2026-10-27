# Running CI locally with `act`

From the repository root, the `checks` job of `client-v2.yml` on the current tree:

```sh
cd client-v2 && act pull_request -C .. -W .github/workflows/client-v2.yml -j checks
```

Config: [`client-v2/.actrc`](../.actrc), read from the directory act is launched in, hence the `cd`; `-C ..` points act at the workflows in the repository root.

## Launching from a worktree

A linked worktree's `.git` is a pointer into the primary checkout, which act does not copy, and `generate-fast` copies `client/public` from the primary checkout too. Mount both, read-only, at their own paths. `--container-options` on the command line replaces the one in `.actrc`, so `--group-add 0` is repeated:

```sh
cd client-v2
main=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
act pull_request -C .. -W .github/workflows/client-v2.yml -j checks \
  --container-options "--group-add 0 -v $main/.git:$main/.git:ro -v $main/client/public:$main/client/public:ro"
```

| Job | Command, from `client-v2` |
| --- | --- |
| `checks` of `client-v2.yml` | `act pull_request -C .. -W .github/workflows/client-v2.yml -j checks` |
| `build` of `client-v2.yml` | `act pull_request -C .. -W .github/workflows/client-v2.yml -j build --container-architecture=linux/amd64` |
| all of `ci.yml` | `act pull_request -C .. -W .github/workflows/ci.yml` |
| `cicd.yml` | `act workflow_dispatch -C .. -W .github/workflows/cicd.yml` |

`build` needs amd64 on every host: wasm-pack 0.10.3 ships no arm64 `wasm-opt`. Without `-W`, `-j checks` also matches the `checks` jobs of `ci.yml` and `cicd.yml`.

| Symptom | Cause | Fix |
| --- | --- | --- |
| `Bind for 0.0.0.0:5432 failed` | the compose Postgres holds the port the `checks` service needs | `docker stop solana-playground-postgres-1` for the run |
| `fatal: not a git repository: .../.git/worktrees/...` | launched from a linked worktree without the mounts | the command under "Launching from a worktree" |
| `Conflict. The container name ... is already in use` | an interrupted run left its containers | `docker ps -a --filter name=act- --format '{{.Names}}' \| xargs docker rm -f` |
| `bind: address already in use` on 34567 | the artifact server of another act run | one act run at a time |
| `permission denied ... docker.sock` in `db-dump.sh`, then `db/schema.sql is stale` | the job's `runner` user cannot reach the daemon socket | `--group-add 0` in `--container-options`, which `.actrc` sets |
| `git status` fails the `build` job | the job needs a clean tree | commit or `git stash -u` first |
