# Neon preview databases

Each git branch that deploys a preview gets its own Neon branch, `preview/<git-branch>`, cut from the empty
parent `preview-base`. Production uses the project's default branch through the project-level `DATABASE_URL`;
see [Deploy the client to Vercel](deploy-client-vercel.md).

## Configuration

| Name | Where to get it |
| --- | --- |
| `NEON_API_KEY` | Neon console → the org named `Vercel: Hoodies` → Settings → API keys → Create new → Project-scoped, for the project below. Only org Admins can mint one, and it is shown once |
| `NEON_PROJECT_ID` | Neon console → the project behind the Vercel Marketplace store `neon-solana-playground` → Settings → General → Project ID |

Both go in two places:

- **`client-v2/.env`**, for the `Makefile.vercel` targets. Make does not read `.env` the way dbmate does, so
  `Makefile.vercel` reads these two names out of it. A value already exported in the shell wins.
- **GitHub**, under the same names, for [`neon-cleanup.yml`](../../.github/workflows/neon-cleanup.yml): the key as a
  repository secret, the project ID as a repository variable, since it grants nothing on its own:

  ```sh
  gh secret set NEON_API_KEY --repo hoodieshq/solana-playground
  gh variable set NEON_PROJECT_ID --repo hoodieshq/solana-playground
  ```

The app never reads either, so neither is set in the Vercel dashboard.

A Vercel-managed Neon account has no CLI login, so `neon login` cannot work: the project-scoped key is the only
way in.

## One-time setup

Cut the empty parent every preview branches from, **before** anything migrates the shared database:

```sh
make -f client-v2/Makefile.vercel neon-preview-base
```

Order matters: `preview-base` is useful only because it is empty. Cut it after `migrate-production-db` and every
preview inherits tables that dbmate then tries to create again.

Previews branch from `preview-base` rather than from the default branch for two reasons. A plain copy-on-write
branch would carry production's rows into every preview. A `--schema-only` branch would carry the tables but leave
`schema_migrations` empty, so dbmate would try to create tables that already exist. An empty parent avoids both.

## A branch per git branch

`scripts/neon-preview-branch.sh` creates `preview/<git-branch>` on first use and prints its connection string. The
name comes from the local branch checked out where `make` runs. Three targets call it:

| Target | What it does with the branch |
| --- | --- |
| `preview-db-branch` | Creates or reuses it and prints its host |
| `migrate-preview-db` | Applies pending migrations to it, with no confirmation prompt |
| `deploy-client-to-vercel-preview` | Passes its pooled URL as the deployment's `DATABASE_URL` |

`migrate-preview-db` applies the whole migration history on first use. The branch belongs to one git branch and
nothing else reads it, so a bad migration costs a `neon branches delete`, not an incident, and two people testing
two migrations cannot corrupt each other. Before previews had their own branches, preview and production shared a
single database.

## Cleanup

The Neon project caps its branch count, so every `preview/*` branch left behind blocks a future preview.
[`neon-cleanup.yml`](../../.github/workflows/neon-cleanup.yml) deletes `preview/<head branch>` when a PR from this
repository merges into `master-2.0`. A PR that never deployed a preview has no branch, and the job passes.

Known limitations, both cleaned up by hand:

- **A PR closed without merging keeps its branch.**
- **The names must match.** The script names the branch after the deployer's local git branch, and the workflow
  after the PR's head branch. A preview deployed from a local branch with a different name, or from a detached
  HEAD (`preview/HEAD`), is not found.

By hand, with both values exported from `client-v2/.env`:

```sh
npx neonctl@latest branches list --project-id "$NEON_PROJECT_ID"
npx neonctl@latest branches delete preview/<git-branch> --project-id "$NEON_PROJECT_ID"
```

## Known gaps

- **The `Makefile.vercel` Neon targets are untested against real Neon.** `neon-preview-base`, `preview-db-branch`
  and `migrate-preview-db` were exercised with a stubbed `neonctl` against a local Postgres, which proves the
  arguments and the shell but not that the Neon API accepts them. `neon-preview-base` is the smallest real call
  and fails fastest.
