# Tasks

All tasks land in one PR for HOO-2685, in this order.

## 1. Tracked assets

- [x] 1.1 Track `client-v2/public/` as the mirror's last output, fold `client-v2/static/` into it, and remove the mirror scripts, the submodule, and `.gitmodules` (HOO-2685); verify every tracked file matches the mirror's hash and `git status` lists no generated file under `public/` after `yarn setup`
- [x] 1.2 Drop the submodule checkout and full history from CI, `preview.yml`, and the Docker image, and the upstream client's services from `compose.yaml` (HOO-2685, after 1.1); verify `docker compose --profile <p> config` for every remaining profile
- [x] 1.3 Update the docs that described the mirror and the removed compose profiles (HOO-2685, after 1.2); verify `git grep -E "update-static|static-overlay|brand-head|client/public|ASSETS_DIR|submodule"` finds only intended mentions
- [x] 1.4 Build `MARKDOWN_TUTORIALS` from `src/tutorials/markdown-tutorials.json`, delete `public/tutorial-timestamps.json` and the git-history dating, and update the tutorial docs and the sync skill's assets step (HOO-2685, after 1.1); verify the built tutorial names and `unixTimestamp` values match the build before the change, and a listed name with no folder fails the build naming it
- [x] 1.5 Restore `scripts/brand-head.mjs` with the card's domain from `resolveSiteUrl`, apply it to upstream's `public/index.html` through CRA's `HtmlWebpackPlugin`, and document `SITE_URL` (HOO-2685, after 1.1); verify `og:url` and `og:image` in `build/index.html` with no env, with `SITE_URL`, and with `VERCEL_PROJECT_PRODUCTION_URL`, and that `yarn dev` serves the branded head

## Workflow follow-up

- Archive the change once a human says yes, in the PR that lands it.
