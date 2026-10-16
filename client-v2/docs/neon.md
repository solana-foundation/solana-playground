# Neon preview databases

A PR into `master-2.0` labelled `preview` gets a preview deployment with its own Neon branch, `preview/pr-<number>`, cut from the
empty parent `preview-base`. A preview deployed by hand from a laptop gets `preview/<git-branch>`. Production uses
the project's default branch through the project-level `DATABASE_URL`; see
[Deploy the client to Vercel](deploy-client-vercel.md).

## Previews from a PR label

The Neon project caps its branch count. The Vercel integration's own option, a branch for every preview
deployment, created one for every pushed git branch: Vercel creates the deployment, and the integration its
branch, before the Ignored Build Step cancels the build. So that option is off, and
[`preview.yml`](../../.github/workflows/preview.yml) owns preview branches instead:

| PR event | What happens |
| --- | --- |
| `preview` label added, or a labelled PR opened, reopened or pushed to | Create or reuse `preview/pr-<n>`, apply pending migrations to it, `vercel build` on the runner, deploy the prebuilt output with the branch's pooled URL as `DATABASE_URL`, and post the URL in one PR comment that later runs edit |
| `preview` label removed, or PR closed or merged | Delete `preview/pr-<n>`, and `preview/<head-branch>` if an older path left one |

A push cancels the deploy it supersedes; a close cancels a deploy still running. PRs from forks get no secrets
and are skipped. The build runs on the runner, as `deploy-client-to-vercel-preview` does, so the project's Ignored
Build Step (which cancels every preview build) does not apply, and `vercel-install.sh` takes the wasm packages
from Remote Cache with the runner's `VERCEL_TOKEN`.

The deployment gets only `DATABASE_URL` from the workflow. The app reads no other `DATABASE_*` variable, so the
integration's project-level ones, if still set for Preview, are unused.

[`preview-sweep.yml`](../../.github/workflows/preview-sweep.yml) is the safety net for a teardown that was
cancelled or failed. Daily, it deletes every `preview/pr-<n>` older than its `MIN_AGE_MINUTES` whose PR is no
longer open and labelled. Run by hand (Actions → preview-sweep → Run workflow) it defaults to a dry run, and scope `all-preview`
extends it to every other `preview/*` branch whose git branch has no open PR: the integration's leftovers and
hand-deployed previews. It never touches `preview-base`, the default branch or a protected branch.

GitHub runs a schedule, and lists a workflow under Run workflow, only from the repository's default branch,
`master`. Until `preview-sweep.yml` is on `master`, it neither runs daily nor can be started from the Actions tab;
clean up by hand meanwhile (see [Cleanup](#cleanup)).

## Configuration

| Name | Where to get it |
| --- | --- |
| `NEON_API_KEY` | Neon console → the org that owns the project below → Settings → API keys → Create new → Project-scoped, for the project below. Only org Admins can mint one, and it is shown once |
| `NEON_PROJECT_ID` | Neon console → the project behind the Vercel Marketplace store `neon-solana-playground` → Settings → General → Project ID |

Both go in two places:

- **`client-v2/.env`**, for the `Makefile.vercel` targets. Make does not read `.env` the way dbmate does, so
  `Makefile.vercel` reads these two names out of it. A value already exported in the shell wins.
- **GitHub**, under the same names, for the [preview workflows](#previews-from-a-pr-label): the key as a
  repository secret, the project ID as a repository variable, since it grants nothing on its own:

  ```sh
  gh secret set NEON_API_KEY --repo solana-foundation/solana-playground
  gh variable set NEON_PROJECT_ID --repo solana-foundation/solana-playground
  ```

The app never reads either, so neither is set in the Vercel dashboard.

`preview.yml` also deploys, so GitHub needs the Vercel side too, and the label:

| Name | Kind | Value |
| --- | --- | --- |
| `VERCEL_TOKEN` | secret | An All Projects token: a project-scoped one cannot drive the CLI (see [Tokens](deploy-client-vercel.md#tokens)). Also used as the Remote Cache token |
| `VERCEL_ORG_ID` | variable | `orgId` in `.vercel/project.json` |
| `VERCEL_PROJECT_ID` | variable | `projectId` in `.vercel/project.json` |

```sh
gh secret set VERCEL_TOKEN --repo solana-foundation/solana-playground
gh variable set VERCEL_ORG_ID --repo solana-foundation/solana-playground
gh variable set VERCEL_PROJECT_ID --repo solana-foundation/solana-playground
gh label create preview --repo solana-foundation/solana-playground --description "Deploy a preview with its own database"
```

In Vercel, turn off the Neon integration's database branch for Preview deployments (Storage → the Neon store →
Settings), or every pushed branch keeps getting a Neon branch regardless of the label.

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

The Neon project caps its branch count, so every `preview/*` branch left behind blocks a future preview. Labelled
PRs clean up after themselves (see [Previews from a PR label](#previews-from-a-pr-label)). A hand-deployed
`preview/<git-branch>` is deleted when a PR with that head branch closes. Otherwise it stays until the
`all-preview` sweep or a hand delete removes it. A hand deploy from a local branch named differently from the
PR's head branch, or from a detached HEAD (`preview/HEAD`), is never matched to a PR.

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
