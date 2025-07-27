# Server

Anything that can be done client-side should be done client-side.

Ideally this server shouldn't exist and everything should be done on clients but unfortunately it's not yet possible to build programs on browsers with the current tooling. This is more of a `rustc` issue and progress is being made in:

- https://github.com/rust-lang/miri/issues/722.
- https://github.com/bytecodealliance/wasmtime/issues/2566

## Setup

The easiest way to run the server is via [Docker Compose](https://github.com/docker/compose):

```sh
docker compose up
```

This will:

1. Create a [PostgreSQL](https://www.postgresql.org/) database
2. Build the server from source
3. Start the server

# Deployment

## Quick Steps to Deploy

There are two common scenarios when deploying:

### 1. Deploying a New Patch Version (e.g., v0.29.1 → v0.29.2)

1. Commit and push your changes to the existing branch (e.g., `v0.29`).
2. Create a new tag for the patch version:
   ```bash
   git tag v0.29.2
   git push origin v0.29.2
   ```
   [See tagging and deployment details below.](#tagging-and-deployment-strategy)
3. GitHub Actions will deploy the new version, accessible at: 
   `https://v0-29-2-dot-playground-server-dot-analytics-324114.de.r.appspot.com/liveness_check`

---

### 2. Deploying a New Minor/Major Version (e.g., v0.29.x → v0.32.x)

1. Create a new branch for the version, e.g., `v0.32`. [See branching details below.](#branching-strategy)
2. Update the GitHub Actions workflow configuration to include this branch as a trigger. [See Github Actions details below](#github-actions-deployment-workflow).
3. Commit and push your changes to this branch.
4. Tag your commit with the new version:
   ```bash
   git tag v0.32.1
   git push origin v0.32.1
   ```
   [See tagging and deployment details below.](#tagging-and-deployment-strategy)
5.  GitHub Actions will deploy the new version, accessible at:  
   `https://v0-32-1-dot-playground-server-dot-analytics-324114.de.r.appspot.com/liveness_check`

---

More detailed explanations of deployment, branching, and tagging strategies can be found in the sections that follow.

## Overview

This project uses **Google App Engine** for deployments. Each deployed version is managed intentionally using:

- Branches for each major [Anchor](https://github.com/solana-foundation/anchor) dependency version
- Git tags for incremental sub-versions within each branch

## Branching Strategy

Each branch corresponds to a specific **Anchor dependency version** used by the project. For example, if your `Cargo.toml` contains:

```
anchor-syn = { version = "0.29.0" }
```

Then the branch should be named `v0.29`.

## Tagging and Deployment Strategy

There are **two separate GitHub Actions workflows**:

1. **ci.yml** – Runs on every push to the branch (for formatting and linting).
2. **deploy.yaml** – Runs **only if the commit has a tag**.

### How Deployment Works

- Deployment only occurs when a **Git tag is pushed**.
- The **tag name becomes the deployed version name** in Google App Engine.
- The tag is normalized (dots replaced with dashes) to form the deployed version URL.

For example, pushing the tag:

```
v0.29.1
```

on branch `v0.29` will result in a deployed App Engine service accessible at:

```
https://v0-29-1-dot-playground-server-dot-analytics-324114.de.r.appspot.com/liveness_check
```

**This means in order to trigger a deployment you commit and push your changes to the branch, then create and push a tag pointing to that commit. A commit without a tag will not get deployed.**

### Tagging Pattern

Within each version branch use **Git tags** to define deployable sub-versions. Tags should follow the pattern:

```
<anchor_major_minor>.<patch>
```

For example:

- First deployment from branch `v0.29` → tag: `v0.29.1`
- Subsequent update → tag: `v0.29.2`


## GitHub Actions Deployment Workflow

**Important:** The GitHub Actions deployment workflow (ci.yml and deploy.yaml) is configured to trigger on a **specific branch**. Every time a new major version branch is introduced, you will need to:

1. Create the new branch: `v0.30`.
2. Update the GitHub Actions deployment YAML to include this branch as a trigger. 

from:
```yaml
on:
  push:
    branches:
      - v0.29
```
to:
```yaml
on:
  push:
    branches:
      - v0.30
```

3. Commit and push the updated workflow file to the new branch
