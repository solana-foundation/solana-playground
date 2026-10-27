# Running CI locally with `act`

See the [`act` docs](https://github.com/nektos/act) for installation and usage.
This covers only the project-specific setup.

The configuration is [`client-v2/.actrc`](../client-v2/.actrc): the runner
image, host networking, the tool-cache directory, and the artifact server
the `e2e-report` job needs. act reads `.actrc` from the directory it is
launched in, so every command below runs from `client-v2`, with `-C ..`
pointing act at the repository root where the workflows live. The file sets
`--container-architecture=linux/arm64`; on an x86_64 host, or for the
`build` job on any host (wasm-pack 0.10.3 ships no arm64 wasm-opt), pass
`--container-architecture=linux/amd64` on the command line, which overrides
the file.

Run one workflow's job (`-W` scopes to one file, `-j` to one job, the event
selects the trigger). Without `-W`, `-j checks` also matches the `checks`
jobs of `ci.yml` and `cicd.yml`:

```bash
act pull_request -C .. -W .github/workflows/client-v2.yml -j checks
act pull_request -C .. -W .github/workflows/ci.yml
act workflow_dispatch -C .. -W .github/workflows/cicd.yml   # deploy pipeline
```

Two things on the host get in the way:

- **Port 5432.** The `checks` job starts a `postgres:16` service on it, and
  the compose stack's Postgres holds the same port: `docker stop` that
  container for the run.
- **A linked worktree.** act copies only the directory it is pointed at
  into the container, and a worktree's `.git` is a file pointing into the
  main checkout, so git fails inside the container (yarn runs `git
  ls-remote` for a git dependency) and the `client/public` submodule is
  empty there. Run act from the main checkout, detached at the commit under
  test: `git checkout --detach <sha>`.

An interrupted run leaves its containers behind; the next run then fails on
a name conflict. `docker ps -a --filter name=act-` lists them.

The `build` job's final `git status` check requires a clean tree: commit or
`git stash -u` your changes first.
