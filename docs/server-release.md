# Server release

How a deployed version of the server goes live, how to roll it back, and how the workflows reach GCP. Covers the App Engine service `playground-server` only; the client rolls back in Vercel.

## Going live and rolling back

A tagged commit on `master` deploys a parked version with no traffic ([cicd.yml](../.github/workflows/cicd.yml)). Traffic moves only through **Actions → Server release → Run workflow** on `master` ([server-release.yml](../.github/workflows/server-release.yml)):

| `version` input | What the run does |
| --------------- | ----------------- |
| `1.2.3` or `1-2-3` | Sends all traffic to that version. |
| empty | Rolls back: sends all traffic to the newest serving version created before the live one. |

App Engine does not record which versions were ever live, so an empty input goes by creation time. A version that was parked and never went live counts, and a second rollback goes further back rather than undoing the first. If a bad version sits between the two, name the version you want.

Dispatched from another branch the run fails and moves nothing. GitHub keeps one waiting run per workflow, so a newer dispatch replaces a waiting one; run them one at a time.

The run changes nothing and fails when the version is unknown or not serving, when the input is malformed, when there is nothing older to roll back to, or when an empty input meets split traffic. After a move it reads the traffic back and fails unless the target holds all of it. Its job summary shows the version before (`split` if traffic was divided) and the target, written before traffic moves, so a run that fails afterwards still names the version to go back to. Split traffic is listed with its shares. A run that fails after choosing its target also lists where traffic is now, since a failed move may still have taken.

The steps do not touch the database or anything else: a rollback returns the code, not the data.

## Signing in to GCP

Both workflows sign in through [gcp-auth](../.github/actions/gcp-auth/action.yml):

- `GCP_WORKLOAD_IDENTITY_PROVIDER` repository variable set: Workload Identity Federation (OIDC). The run gets a short-lived token; `GCP_KEY` is passed to the action but ignored.
- Variable empty: the `GCP_KEY` secret, a service-account JSON key.

`SERVICE_ACCOUNT` and `PROJECT_ID` are read in both cases. Each run's annotations name the path it took.

### Setting up OIDC, and retiring the key

The one-time setup is step 10 of the [production runbook](../client-v2/docs/production-runbook.md#step-10-the-build-servers-releases-and-its-sign-in-to-gcp):
the role that lets the service account move traffic, the Workload Identity pool `github-server` and its provider,
the variable, the checks, and deleting the key.

The provider's condition admits only tokens from `master` of this repository, by its id: a workflow edited on a
branch gets no token, whatever it says, and neither does a **CICD** run dispatched from a branch, so once the
variable is set, deploys start from `master`. Until `GCP_KEY` is deleted, the key path has no such limit: a
workflow file on a branch can read the secret. After the key is deleted, drop the key path from `gcp-auth` and the
`GCP_KEY` row from `server/README.md`.
