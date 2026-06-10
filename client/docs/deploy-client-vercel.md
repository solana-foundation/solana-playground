# Deploy the client to Vercel

Two deploy paths exist:

- **Automatic** via Vercel's native GitHub integration — pushes to `master` deploy to production, pushes to any other branch produce a preview.
- **Manual** via the `_deploy_client_vercel.yml` GitHub Action or the Makefile targets — kept as an escape hatch (re-deploy a specific ref without pushing, force a rebuild).

The automatic path runs `client/scripts/vercel-install.sh` as the `installCommand`. That script bootstraps `rustup` under `node_modules/.cache/` (so Vercel's auto-cache persists the toolchain between deploys), compiles the wasm crates via `wasm/build.sh`, and then runs `yarn install`. The wasm step must happen before `yarn install` because `client/package.json` has file-deps like `"../wasm/anchor-cli/pkg"` that don't exist until `wasm-pack` runs. The `buildCommand` is then just `yarn build`. Cold builds pay the rustup + 6-crate compile cost; subsequent builds reuse the cached toolchain and cargo target dir.

## Verified Vercel project settings

The configuration below is what actually completed a build end-to-end (Enterprise + Enhanced builder, ~18 min cold). Mirror these when creating a new project (e.g. on another org or fork) to avoid replaying the iteration history.

| Setting | Value |
| --- | --- |
| Plan / Build Machine | Enterprise + **Enhanced** (Standard not yet measured) |
| Framework Preset | Other |
| Root Directory | `client` |
| Production Branch | `master` |
| Ignored Build Step | Automatic (default) |
| Node version | `22.x` (project setting); `client/package.json` engines is `^22.20.0` |
| Deploys | Automatic via native Git integration |

## One-time setup

1. Create a Vercel project. **Framework Preset:** Other. **Root Directory:** `client`.
2. **Settings → Build and Deployment → Build Machine:** on Enterprise, choose **Enhanced** (or Turbo if needed). On Pro, keep the default.
3. **Settings → Git → Ignored Build Step:** leave **Automatic** (default). Vercel's monorepo behavior auto-skips builds when no files under `client/` change.
4. **Settings → Git → Production Branch:** `master`.
5. **Settings → General → Node.js Version:** `22.x`.
6. **Settings → Environment Variables:** add `REACT_APP_SOLANA_FOUNDATION_SERVER_URL` (full URL of the Solana Foundation-hosted backend with `https://`, no trailing slash) and tick **both** Production and Preview. Local Makefile targets read from whichever environment you deploy to.
7. **GitHub repo/environment Variables or Secrets:** add `REACT_APP_SOLANA_FOUNDATION_SERVER_URL`. The GHA workflow reads it from GitHub and deploys to Preview.
8. **Account Settings → Tokens:** create a team-scoped token. Save it as:
   - GitHub repo secret `VERCEL_TOKEN` (for the workflow).
   - Local shell `export VERCEL_TOKEN=...` (for the Makefile).
9. Link the local checkout to the existing Vercel project (from the repo root, since Vercel's Root Directory is `client`):

   ```sh
   VERCEL_PROJECT_ID=prj_xxx make vercel-bootstrap
   ```

   `VERCEL_PROJECT_ID` is the project's ID from **Settings → General → Project ID** in the Vercel dashboard. The target resolves the `orgId` from the Vercel API and writes `.vercel/project.json`.

Also add the Vercel deployment origin to the GAE server's `client_urls`, or every browser request fails CORS.

## Deploy

- **Automatic:** push to `master` → production; push to any other branch → preview. The Vercel-side build runs `bash scripts/vercel-install.sh` followed by `yarn build`.
- **GitHub manual:** Actions → "Deploy Client (Vercel)" → "Run workflow". Optional `ref` input (default `master`). Builds on the GH runner and uploads via `vercel deploy --prebuilt`.
- **Local — preview** (unique URL, no auto-promote), from repo root:
  ```sh
  VERCEL_TOKEN=<token> make deploy-client-to-vercel-preview
  ```
  Promote later with `vercel promote <url> --prod` or via the dashboard.
- **Local — production** (live immediately on the prod alias), from repo root:
  ```sh
  VERCEL_TOKEN=<token> make deploy-client-to-vercel-production
  ```

Each target has a matching `vercel-link-{production,preview}` that's run automatically as a prerequisite.

For GitHub workflow deploys, `REACT_APP_SOLANA_FOUNDATION_SERVER_URL` must be configured as a GitHub repo/environment variable or secret.

For local Makefile deploys, `REACT_APP_SOLANA_FOUNDATION_SERVER_URL` must be configured in Vercel for whichever environment you're deploying to (Production for `-production`, Preview for `-preview`, or both).

## Endpoint routing

Split is deliberate:

- **All routes except share routes are configurable** (`REACT_APP_SOLANA_FOUNDATION_SERVER_URL` at build time, also user-overridable via the `server.endpoint` setting) — so self-hosted forks can route client requests to their own backend.
- **Share routes (`/share/*`, `/new`) are locked to `https://api.solpg.io`** — so shared snippets stay discoverable from one canonical store regardless of where the client is hosted.

For GitHub workflow deploys, `REACT_APP_SOLANA_FOUNDATION_SERVER_URL` is read from GitHub variables or secrets. For local Makefile deploys, it is read from the Vercel project's environment variables (pulled via `vercel pull` before the build).

## Planned: offload wasm build to GitHub Actions

Cold builds currently spend most of their ~18 min on Rust→WASM compilation inside Vercel. The intended evolution is for GitHub Actions to build the 6 wasm crates once per `wasm/**` change, tar the outputs, and publish them as a release asset keyed by content hash. `client/scripts/vercel-install.sh` will then attempt to `curl` the matching tarball and extract it into `wasm/*/pkg/` instead of compiling Rust on Vercel. It will fall back to the existing rustup-and-compile path if no matching tarball exists. `client/package.json`'s `file://` deps and the local `yarn setup` workflow stay unchanged. Since the repo is public, no extra tokens are required on either side.
