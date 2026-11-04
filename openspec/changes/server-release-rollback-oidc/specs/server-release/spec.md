# Spec Delta

## Purpose

Defines how a deployed version of the Playground server is made live or rolled back from GitHub Actions, and how release automation authenticates to GCP.

## ADDED Requirements

### Requirement: Promote a named version
A manual workflow run given a version SHALL send 100% of `playground-server` traffic to that version. A version written as its git tag (`1.2.3`) SHALL be read as its App Engine label (`1-2-3`).

#### Scenario: Known serving version
- **WHEN** the run names a version that exists and is serving
- **THEN** that version receives all traffic and the run succeeds

#### Scenario: Version given as a tag
- **WHEN** the run names `1.2.3` and version `1-2-3` exists and is serving
- **THEN** version `1-2-3` receives all traffic

#### Scenario: Version already live
- **WHEN** the named version already receives all traffic
- **THEN** traffic is not changed and the run succeeds, saying so in its summary

### Requirement: Refuse an unusable target
A run SHALL fail without changing traffic when its target cannot take traffic.

#### Scenario: Unknown version
- **WHEN** the run names a version that does not exist
- **THEN** the run fails, names the version and lists the existing ones, and traffic is unchanged

#### Scenario: Stopped version
- **WHEN** the named version exists but is not serving
- **THEN** the run fails and traffic is unchanged

#### Scenario: Malformed version
- **WHEN** the version contains anything but lowercase letters, digits, dashes or dots
- **THEN** the run fails before any gcloud traffic command runs

#### Scenario: Unreadable version list
- **WHEN** a version in the list lacks its id, status or creation time
- **THEN** the run fails and traffic is unchanged

### Requirement: Roll back to the previous version
A manual run given no version SHALL send all traffic to the newest serving version created before the one that receives all traffic now.

#### Scenario: A previous version exists
- **WHEN** version `b` receives all traffic and `a` is the newest serving version created before it
- **THEN** version `a` receives all traffic

#### Scenario: A newer parked version exists
- **WHEN** a version newer than the live one is parked
- **THEN** it is not chosen

#### Scenario: Nothing to roll back to
- **WHEN** no serving version was created before the live one
- **THEN** the run fails and traffic is unchanged

#### Scenario: Traffic is split
- **WHEN** no single version receives all traffic
- **THEN** the run fails, asks for a named version, and traffic is unchanged

### Requirement: Report what changed
A run that moves traffic SHALL read the traffic back and write the version before and the version after to its job summary, and SHALL fail if the target does not hold all traffic.

#### Scenario: Traffic moved
- **WHEN** a run moves traffic from `b` to `a`
- **THEN** the job summary shows `b` before and `a` after

### Requirement: Runs only from the default branch
The promote and rollback workflow SHALL run only on `master`.

#### Scenario: Dispatched from another branch
- **WHEN** the workflow is dispatched on any other branch
- **THEN** no job that can reach GCP runs

### Requirement: Authenticate through OIDC when configured
Deploy and promote SHALL authenticate through Workload Identity Federation when the repository variable `GCP_WORKLOAD_IDENTITY_PROVIDER` is set, and with the `GCP_KEY` secret when it is not.

#### Scenario: Provider configured
- **WHEN** the variable is set
- **THEN** the run authenticates with a short-lived OIDC token and does not read `GCP_KEY`

#### Scenario: Provider not configured
- **WHEN** the variable is empty
- **THEN** the run authenticates with `GCP_KEY`, as before this change

### Requirement: Deploy stays parked
Deploying a tagged release SHALL NOT move traffic.

#### Scenario: Tagged release
- **WHEN** a tagged commit deploys
- **THEN** the new version is uploaded with no traffic, and going live takes a promote run
