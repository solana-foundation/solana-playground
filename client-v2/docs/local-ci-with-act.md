# Running CI locally with `act`

Config: [`client-v2/.actrc`](../.actrc), read from the directory act is launched in. Run from `client-v2`, with `-C ..` for the workflows at the repository root.

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
| `fatal: not a git repository: .../.git/worktrees/...` | a linked worktree's `.git` is a pointer act does not copy; `client/public` is empty there too | run from the main checkout: `git checkout --detach <sha>` |
| `Conflict. The container name ... is already in use` | an interrupted run left its containers | `docker ps -a --filter name=act- --format '{{.Names}}' \| xargs docker rm -f` |
| `bind: address already in use` on 34567 | the artifact server of another act run | one act run at a time |
| `git status` fails the `build` job | the job needs a clean tree | commit or `git stash -u` first |
