# Tasks

## 1. Server

- [x] 1.1 Replace `ApiKey` with `ApiKeys`, read from `PG_API_KEYS` and `PG_API_KEY`, compared against every entry in constant time and redacted in `Debug`; verify with `cargo test` in `server/` (`every_listed_key_passes`, `a_removed_key_is_401_and_the_others_still_pass`, `the_single_key_joins_the_list`, `debug_redacts_every_key`) and `cargo clippy --all-targets --features unstable -- -D warnings`. HOO-2890
- [x] 1.2 Log the accepted key count at start-up and name both variables in the warning when neither is set; verify by starting the server with `RUST_LOG=info PG_API_KEYS=a,b` and reading `2 accepted` in its log. HOO-2890, after 1.1

## 2. Documentation

- [x] 2.1 Describe the list in `server/app.yaml`, `client-v2/docs/production-runbook.md`, `client-v2/.env.example`, the comments of `api/build-server.mjs` and `shared/config/server-env.mjs`, and the manual steps of `docs/testing.md` D-9; verify `git grep PG_API_KEY` outside `openspec/` finds no text that still describes a single key. HOO-2890, alongside 1.1

## 3. Manual check

- [x] 3.1 Run the `docs/testing.md` D-9 steps with `PG_API_KEYS=<key a>,<key b>`: either key passes the key check, no key and an unlisted key get `401`, and after removing `<key b>` and restarting, `<key b>` gets `401` while `<key a>` passes. HOO-2890, after 1.1 and 2.1

## Workflow follow-up

- Archive the change once the PR is merged.
