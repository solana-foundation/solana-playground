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

### Setting up OIDC, once

Needs IAM rights in the project. The service account keeps the roles it deploys with today.

```sh
PROJECT_ID=...
SERVICE_ACCOUNT=...   # the value of the SERVICE_ACCOUNT secret
REPO_ID=1003072868   # solana-foundation/solana-playground; `gh api repos/solana-foundation/solana-playground --jq .id`

gcloud services enable iamcredentials.googleapis.com --project="$PROJECT_ID"

gcloud iam workload-identity-pools create github \
  --project="$PROJECT_ID" --location=global \
  --display-name="GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc solana-playground \
  --project="$PROJECT_ID" --location=global \
  --workload-identity-pool=github \
  --display-name="solana-playground" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository_id=assertion.repository_id" \
  --attribute-condition="assertion.repository_id == '$REPO_ID' && assertion.ref == 'refs/heads/master'"

POOL=$(gcloud iam workload-identity-pools describe github \
  --project="$PROJECT_ID" --location=global --format='value(name)')

gcloud iam service-accounts add-iam-policy-binding "$SERVICE_ACCOUNT" \
  --project="$PROJECT_ID" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/$POOL/attribute.repository_id/$REPO_ID"

gcloud iam workload-identity-pools providers describe solana-playground \
  --project="$PROJECT_ID" --location=global \
  --workload-identity-pool=github --format='value(name)'
```

Set the last command's output as the repository variable `GCP_WORKLOAD_IDENTITY_PROVIDER`.

The condition is what limits this to `master` of this repository: a workflow edited on a branch gets no token, whatever it says. A **CICD** run dispatched from a branch gets none either, so once the variable is set, deploys start from `master`. It uses the repository's id because a name can be taken over after a rename. Until `GCP_KEY` is deleted, the key path has no such limit: a workflow file on a branch can read the secret.

### Proving it, then retiring the key

1. Run **Server release** with the live version as `version`. Nothing moves; a green run whose annotation names Workload Identity Federation proves OIDC and the workflow's reading of the version list.
2. Run it with `version` empty, then with the version that was live. Traffic goes back and forth; check both summaries. This needs an older serving version.
3. Let the next tagged release deploy.
4. Delete the `GCP_KEY` secret, then the key itself: `gcloud iam service-accounts keys list --iam-account="$SERVICE_ACCOUNT"` and `keys delete <id> --iam-account="$SERVICE_ACCOUNT"`.

To back out before step 4, clear the variable: runs return to the key. After step 4, drop the key path from `gcp-auth` and the `GCP_KEY` row from `server/README.md`.
