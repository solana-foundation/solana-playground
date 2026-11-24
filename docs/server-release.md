# Server release

How a deployed version of the server goes live, how to roll it back, and how the workflows reach GCP. Covers the App Engine service `playground-server` only; the client rolls back in Vercel.

## Going live and rolling back

A tagged commit on `master` deploys a parked version with no traffic ([cicd.yml](../.github/workflows/cicd.yml)). Traffic moves only through **Actions → Server: release → Run workflow** on `master` ([server-release.yml](../.github/workflows/server-release.yml)):

| `version` input | What the run does |
| --------------- | ----------------- |
| `1.2.3` or `1-2-3` | Sends all traffic to that version. |
| empty | Rolls back: sends all traffic to the newest serving version created before the live one. |

App Engine does not record which versions were ever live, so an empty input goes by creation time. A version that was parked and never went live counts, and a second rollback goes further back rather than undoing the first. If a bad version sits between the two, name the version you want.

Dispatched from another branch, or in a fork such as `hoodieshq/solana-playground`, the run fails and moves nothing. In a fork, **Server: deploy** deploys nothing either: a push passes with a notice, a dispatch fails. GitHub keeps one waiting run per workflow, so a newer dispatch replaces a waiting one; run them one at a time.

The run changes nothing and fails when the version is unknown or not serving, when the input is malformed, when there is nothing older to roll back to, or when an empty input meets split traffic. After a move it reads the traffic back and fails unless the target holds all of it. Its job summary shows the version before (`split` if traffic was divided) and the target, written before traffic moves, so a run that fails afterwards still names the version to go back to. Split traffic is listed with its shares. A run that fails after choosing its target also lists where traffic is now, since a failed move may still have taken.

The steps do not touch the database or anything else: a rollback returns the code, not the data.

## Signing in to GCP

Both workflows sign in through [gcp-auth](../.github/actions/gcp-auth/action.yml):

- `GCP_WORKLOAD_IDENTITY_PROVIDER` repository variable set: Workload Identity Federation (OIDC). The run gets a short-lived token; `GCP_KEY` is passed to the action but ignored.
- Variable empty: the `GCP_KEY` secret, a service-account JSON key.

`SERVICE_ACCOUNT` and `PROJECT_ID` are read in both cases. Each run's annotations name the path it took.

### Only `master` reaches the deploy identity

Three locks keep a workflow on any other branch from deploying or moving traffic. Locks 1 and 2 are settings, not code in
this repository; step 10 of the [production runbook](../client-v2/docs/production-runbook.md#step-10-the-build-servers-releases-and-its-sign-in-to-gcp)
sets both. Lock 1 alone covers the OIDC path; while `GCP_KEY` exists, only lock 2 covers the key path.

1. **The OIDC provider.** Its attribute condition admits a token only when `repository_id` is this repository's
   and `ref` is `refs/heads/master`. A workflow edited on a branch, or a run dispatched from one, gets no token. The
   condition is set in GCP, not in this repository; see the next section.
2. **The `playground-server` environment.** The two jobs that sign in to GCP (`deploy_server` in
   [cicd.yml](../.github/workflows/cicd.yml), `release` in [server-release.yml](../.github/workflows/server-release.yml))
   run in it. Its deployment branch rule admits `master` only, and `GCP_KEY`, `SERVICE_ACCOUNT` and `PROJECT_ID`
   are environment secrets, so a job on another branch neither starts in it nor reads them. This also closes the
   key path while `GCP_KEY` still exists. The rule and the secrets are repository settings.
3. **The workflows.** Both stop a run from any ref but `refs/heads/master` before they sign in. This lock only
   fails early with a clear message: a branch can edit its own copy of the workflow, which is why 1 and 2 exist.

The version tag reaches the deploy command through `env:` (`VERSION_TAG`), and the resolving script reads the event
and ref from the runner's environment, so no value is pasted into a script by an expression.

### Setting up OIDC, and retiring the key

The one-time setup is step 10 of the [production runbook](../client-v2/docs/production-runbook.md#step-10-the-build-servers-releases-and-its-sign-in-to-gcp):
the role that lets the service account move traffic, the Workload Identity pool `github-server` and its provider,
the variable, the checks, and deleting the key.

The provider's condition admits only tokens from `master` of this repository, by its id: a workflow edited on a
branch gets no token, whatever it says. Until `GCP_KEY` is deleted, the key path relies on lock 2 above: while the
key is still a repository secret rather than a `playground-server` environment secret, a workflow file on a branch
can read it. After the key is deleted, drop the key path from `gcp-auth` and the
`GCP_KEY` row from `server/README.md`.
