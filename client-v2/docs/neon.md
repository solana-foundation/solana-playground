# Neon preview databases

A PR labelled `preview`, whatever its base branch, in the repository the `PREVIEW_REPOSITORY` variable names, gets a
preview deployment with its own Neon branch, `preview/pr-<number>`, cut from `main`, the default branch of the preview
Neon project. A preview deployed by hand from a laptop gets `preview/<git-branch>`. Production's database is in a Neon
project of its own, which no preview reads; production reaches it through the Production-scoped `DATABASE_URL`, see
[Deploy the client to Vercel](deploy-client-vercel.md).

## Previews from a PR label

The Neon project caps its branch count. The Vercel integration's own option, a branch for every preview
deployment, creates one for every pushed git branch, since the Git integration deploys every push. So that
option is off, a preview the Git integration deploys runs with the project's Preview-scoped variables, and
[`preview.yml`](../../.github/workflows/preview.yml) owns preview branches instead:

| PR event | What happens |
| --- | --- |
| `preview` label added, or a labelled PR opened, reopened or pushed to | Create or reuse `preview/pr-<n>`, apply pending migrations to it, `vercel build` on the runner, deploy the prebuilt output with the branch's pooled URL as `DATABASE_URL`, and post the URL in one PR comment that later runs edit |
| `preview` label removed, or PR closed or merged | Delete `preview/pr-<n>`, and `preview/<head-branch>` if an older path left one |

A push cancels the deploy it supersedes; a close cancels a deploy still running. PRs from forks and runs that
Dependabot triggers get no deploy secrets and are skipped, and a Dependabot PR never gets a preview, even
labelled by a human. The build runs on the runner, as `deploy-client-to-vercel-preview` does, and
`vercel-install.sh` takes the wasm packages from Remote Cache with the runner's `VERCEL_TOKEN`.

The deployment gets only `DATABASE_URL` from the workflow. The app reads no other `DATABASE_*` variable, so the
integration's project-level ones are unused there. A preview the Git integration deploys does read the Preview-scoped
`DATABASE_URL`, which must name a database in the preview Neon project, never production's
([Sign-in on previews](deploy-client-vercel.md#sign-in-on-previews)).

[`preview-sweep.yml`](../../.github/workflows/preview-sweep.yml) is the safety net for a teardown that was
cancelled or failed. Daily, it deletes every `preview/pr-<n>` older than its `MIN_AGE_MINUTES` whose PR is no
longer open and labelled. Run by hand (Actions → preview-sweep → Run workflow) it defaults to a dry run, and scope `all-preview`
extends it to every other `preview/*` branch whose git branch has no open PR: the integration's leftovers and
hand-deployed previews. It never touches `main` (the default branch), a protected branch, or `preview/master`, the
production dry run's branch, which the teardown keeps too.

GitHub runs a schedule, and lists a workflow under Run workflow, only from the repository's default branch,
`master`, so a change to `preview-sweep.yml` takes effect only once it is on `master`. Both preview workflows run
only in the repository that the `PREVIEW_REPOSITORY` variable names and that has `NEON_PROJECT_ID` set, the one
that holds the Neon and Vercel credentials; every other repository skips them. A labelled PR on another repository
or from a fork gets skipped preview checks and no comment.

## Configuration

The `gh` commands in this section take the repository that runs the preview workflows from `REPO`, set once in the
shell:

```sh
REPO=<owner>/<name>   # the repository whose PRs get previews
```

| Name | Where to get it |
| --- | --- |
| `NEON_API_KEY` | Neon console → the org that owns the project below → Settings → API keys → Create new → Project-scoped, for the project below. Only org Admins can mint one, and it is shown once |
| `NEON_PROJECT_ID` | Neon console → the preview Neon project, not production's → Settings → General → Project ID |

Both go in two places:

- **`client-v2/.env`**, for the `Makefile.vercel` targets. Make does not read `.env` the way dbmate does, so
  `Makefile.vercel` reads these two names out of it. A value already exported in the shell wins.
- **GitHub**, under the same names, for the [preview workflows](#previews-from-a-pr-label): the key as a
  repository secret, the project ID as a repository variable, since it grants nothing on its own. Only GitHub
  needs `PREVIEW_REPOSITORY` (`client-v2/.env` does not), a repository variable whose value is `REPO`; the preview
  workflows run only where it equals `github.repository`. It holds a repository name, not a boolean, because a
  variable set at organisation level reaches every repository it is shared with: set there, it still enables one
  repository. At organisation level, share it with that repository alone, or set it per repository:

  ```sh
  gh secret set NEON_API_KEY --repo "$REPO"
  gh variable set NEON_PROJECT_ID --repo "$REPO"
  gh variable set PREVIEW_REPOSITORY --repo "$REPO" --body "$REPO"
  ```

The app reads neither `NEON_API_KEY` nor `NEON_PROJECT_ID`, so neither is set in the Vercel dashboard.

`preview.yml` also deploys, so GitHub needs the Vercel side too, and the label:

| Name | Kind | Value |
| --- | --- | --- |
| `VERCEL_TOKEN` | secret | An All Projects token: a project-scoped one cannot drive the CLI (see [Tokens](deploy-client-vercel.md#tokens)). Also used as the Remote Cache token |
| `VERCEL_ORG_ID` | variable | `orgId` in `.vercel/project.json` |
| `VERCEL_PROJECT_ID` | variable | `projectId` in `.vercel/project.json` |

```sh
gh secret set VERCEL_TOKEN --repo "$REPO"
gh variable set VERCEL_ORG_ID --repo "$REPO"
gh variable set VERCEL_PROJECT_ID --repo "$REPO"
gh label create preview --repo "$REPO" --description "Deploy a preview with its own database"
```

In Vercel, turn off the Neon integration's database branch for Preview deployments (Storage → the Neon store →
Settings), or every pushed branch keeps getting a Neon branch regardless of the label.

A Vercel-managed Neon account has no CLI login, so `neon login` cannot work: the project-scoped key is the only
way in.

## The parent branch

Every preview branch is cut from `main`, the default branch of the preview Neon project (`NEON_BASE_BRANCH`
overrides it). The preview project is separate from production's so that no preview holds production's data: every
preview holds `AUTH_OAUTH_PROXY_SECRET`, and whoever holds one preview's environment can forge a session on any
preview ([Sign-in on previews](deploy-client-vercel.md#sign-in-on-previews)). A branch carries `main`'s rows, and
those are preview data.

A copy-on-write branch carries `main`'s schema and its `schema_migrations`, so dbmate applies only the migrations
`main` lacks, the PR's among them. A `--schema-only` branch would not do: it carries the tables but leaves
`schema_migrations` empty, so dbmate would try to create tables that already exist.

The empty `preview-base` parent this replaced is no longer read by anything. Delete it from the Neon project once
no preview branch still has it as its parent.

## A branch per git branch

`scripts/neon-preview-branch.sh` creates `preview/<git-branch>` on first use and prints its connection string. The
name comes from the local branch checked out where `make` runs. Three targets call it:

| Target | What it does with the branch |
| --- | --- |
| `preview-db-branch` | Creates or reuses it and prints its host |
| `migrate-preview-db` | Applies pending migrations to it, with no confirmation prompt |
| `deploy-client-to-vercel-preview` | Passes its pooled URL as the deployment's `DATABASE_URL` |

`migrate-preview-db` applies the migrations the git branch has and `main` lacks. The branch belongs to one git branch and
nothing else reads it, so a bad migration costs a `neon branches delete`, not an incident, and two people testing
two migrations cannot corrupt each other. A Git-triggered preview has no branch of its own: it shares the database
the Preview-scoped `DATABASE_URL` names with every other Git-triggered preview.

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

- **The `Makefile.vercel` Neon targets are untested against real Neon.** `preview-db-branch` and
  `migrate-preview-db` were exercised with a stubbed `neonctl` against a local Postgres, which proves the
  arguments and the shell but not that the Neon API accepts them. `preview-db-branch` is the smallest real call
  and fails fastest.
