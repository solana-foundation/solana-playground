# Proposal

## Why

The Rust server in `server/` is the fork's build backend, and production runs one database, Postgres, reached
only from `client-v2/api`. The server's share routes need MongoDB, which no deployment provides, so `/share/{id}`
and `/new` cannot work in production. They still make every server build compile a MongoDB driver, read
`PG_DB_URI` and `PG_DB_NAME`, and expose two routes that only fail. client-v2 already shares projects through gists
and no longer opens server shares.

## What Changes

- **BREAKING (server):** `GET /share/{id}` and `POST /new` are removed. The server answers both with 404, in the
  stable and the `unstable` builds.
- **Server:** the server holds no database. `server/src/db.rs`, `db::init`, the `PG_DB_URI` and `PG_DB_NAME`
  settings, and the `mongodb` crate are removed. The server starts with no database to reach.
- **client-v2:** the dead server-share code is removed: `PgShare` (`src/utils/share.ts`), `PgServer.shareGet`,
  `PgServer.shareNew` and the `useDbServer` option that sent them to `https://api.solpg.io`, the route
  `routes/share` (its `validate` always returns `false`), and the explorer modal `Modals/Share.tsx`, which nothing
  mounts. Users see no change: the route never matched and the modal never opened. Gist sharing is untouched.
- **compose.yaml:** the `db` service (`mongo:7`), the `mongodb` volume, and `PG_DB_URI` are removed. The `dev` and
  `prod` profiles start one container fewer.
- **Docs:** `docs/testing.md`, the root `CLAUDE.md`, `docs/persistent-conversations-spec.md`, `server/README.md`,
  `client-v2/docs/deploy-client-vercel.md`, `.env.example`, and the comments in `compose.yaml` and
  `.github/workflows/reusable-client-v2.yml` stop describing the server's MongoDB and share routes.
- **Telemetry:** no slice under `features/` or `widgets/` changes, so no event is added, renamed, or removed.
- **Funnels:** no funnel step's code changes. `funnel-events` names `routes/share/share.tsx` only as a route that
  never matches.

## Capabilities

### New Capabilities

- `build-server`: the HTTP routes the Rust server in `server/` serves, and what it needs to start.

### Modified Capabilities

None.

## Impact

- **Code:** `server/src/{main.rs,lib.rs,config.rs,db.rs,routes/mod.rs,routes/share.rs}`, `server/Cargo.toml`,
  `server/Cargo.lock`; `client-v2/src/utils/{server.ts,server.test.ts,share.ts,index.ts}`,
  `client-v2/src/routes/share/`, the route list that registers it, and
  `client-v2/src/views/sidebar/explorer/Component/Modals/{Share.tsx,index.ts}`.
- **Deploy:** App Engine (`cicd.yml`, `server/app.yaml`) sets no database variable, so the deployment config does
  not change. A `PG_DB_URI` or `PG_DB_NAME` set on the service by hand is ignored after this change.
- **Local stacks:** in the `dev` profile, upstream's `client/` still shows Share; its requests to the local server
  return 404. Before this change they reached the compose MongoDB.
- **Out of scope:** `client/` stays byte-identical to upstream, so its Share button and share route stay as they
  are. Share links created on `https://api.solpg.io` are upstream's and unaffected. The `/build`, `/deploy`, and
  `/unstable/*` routes do not change.
