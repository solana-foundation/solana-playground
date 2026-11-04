# Server release

How a deployed version of the server goes live, how to roll it back, and how the workflows reach GCP. Covers the App Engine service `playground-server` only; the client rolls back in Vercel.

## Going live and rolling back

A tagged commit on `master` deploys a parked version with no traffic ([cicd.yml](../.github/workflows/cicd.yml)). Traffic moves only through **Actions → Server release → Run workflow** on `master` ([server-release.yml](../.github/workflows/server-release.yml)):

| `version` input | What the run does |
| --------------- | ----------------- |
| `1.2.3` or `1-2-3` | Sends all traffic to that version. |
| empty | Rolls back: sends all traffic to the newest serving version created before the live one. |

The run changes nothing and fails when the version is unknown or not serving, when the input is malformed, when there is nothing older to roll back to, or when an empty input meets split traffic. After a move it reads the traffic back and fails unless the target holds all of it. Its job summary shows the version before and after.

The steps do not touch the database or anything else: a rollback returns the code, not the data.

## Signing in to GCP

Both workflows sign in through [gcp-auth](../.github/actions/gcp-auth/action.yml):

- `GCP_WORKLOAD_IDENTITY_PROVIDER` repository variable set: Workload Identity Federation (OIDC). The run gets a short-lived token, and `GCP_KEY` is not read.
- Variable empty: the `GCP_KEY` secret, a service-account JSON key.

`SERVICE_ACCOUNT` and `PROJECT_ID` are read in both cases.

### Setting up OIDC, once

Needs IAM rights in the project. The service account keeps the roles it deploys with today.

```sh
PROJECT_ID=...
SERVICE_ACCOUNT=...   # the value of the SERVICE_ACCOUNT secret
REPO=solana-foundation/solana-playground

gcloud services enable iamcredentials.googleapis.com --project="$PROJECT_ID"

gcloud iam workload-identity-pools create github \
  --project="$PROJECT_ID" --location=global \
  --display-name="GitHub Actions"

gcloud iam workload-identity-pools providers create-oidc solana-playground \
  --project="$PROJECT_ID" --location=global \
  --workload-identity-pool=github \
  --display-name="solana-playground" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository == '$REPO' && assertion.ref == 'refs/heads/master'"

POOL=$(gcloud iam workload-identity-pools describe github \
  --project="$PROJECT_ID" --location=global --format='value(name)')

gcloud iam service-accounts add-iam-policy-binding "$SERVICE_ACCOUNT" \
  --project="$PROJECT_ID" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/$POOL/attribute.repository/$REPO"

gcloud iam workload-identity-pools providers describe solana-playground \
  --project="$PROJECT_ID" --location=global \
  --workload-identity-pool=github --format='value(name)'
```

Set the last command's output as the repository variable `GCP_WORKLOAD_IDENTITY_PROVIDER`.

The condition is what limits this to `master` of this repository: a workflow edited on a branch gets no token, whatever it says.

### Proving it, then retiring the key

1. Run **Server release** with the live version as `version`. Nothing moves; a green run proves OIDC and the workflow's reading of the version list.
2. Run it with `version` empty, then with the version that was live. Traffic goes back and forth; check both summaries.
3. Let the next tagged release deploy.
4. Delete the `GCP_KEY` secret, then the key itself: `gcloud iam service-accounts keys list --iam-account="$SERVICE_ACCOUNT"` and `keys delete <id> --iam-account="$SERVICE_ACCOUNT"`.

To back out before step 4, clear the variable: runs return to the key.
