# Proposal

## Why

A tagged server release lands on App Engine as a parked version, and making it live or going back is done by hand in the GCP console, so undoing a bad release needs a person with console rights at that moment. The deploy reaches GCP with a service-account JSON key stored as a GitHub secret, which does not expire and lets anyone who reads it deploy. Tracked in HOO-484.

## What Changes

- A manually run GitHub Actions workflow moves all traffic of the `playground-server` service to a named version, or, with no version given, back to the version before the one serving now. User-visible consequence: a bad server release is undone in minutes, from GitHub, without GCP console access.
- The deploy and the new workflow authenticate through Workload Identity Federation (OIDC) once a repository variable names the provider, and keep using `GCP_KEY` until then. User-visible consequence: none for Playground users; merging does not interrupt deploys, and the stored key can be deleted once the pool exists.
- A new document describes promote, rollback and the one-time GCP setup, with the gcloud commands.
- No slice under `features/` or `widgets/` changes, so no telemetry events are added, renamed or removed.

## Capabilities

### New Capabilities

- `server-release`: how a deployed server version is made live or rolled back, and how release automation authenticates to GCP.

### Modified Capabilities

None.

## Impact

- Code: `.github/workflows/cicd.yml`, a new workflow and a shared auth step under `.github/`, a target-selection script with tests under `client-v2/scripts/lib/`, a new document under `docs/`, one line in `server/README.md`.
- Systems: GCP needs a Workload Identity pool and provider, created by someone with IAM rights; until then the key path keeps working.
- Out of scope: the client's rollback on Vercel, the unstable server's deploy (HOO-1600), creating the GCP pool, automatic promotion on deploy (`--no-promote` stays), and any change under `server/` beyond one line: `server/README.md` gets a pointer to the new document in place of its "cut over manually" sentence (an exception to the rule that `server/` is not modified, Slava, 2026-11-05).
