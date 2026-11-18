# Design

## Context

`require_api_key` guards the build, deploy and unstable routes with one
`ApiKey`, read from `PG_API_KEY` and compared with `constant_time_eq`. `main`
logs the whole `Config` at start, so the key type's `Debug` redacts it. See
proposal.md for why one key is not enough.

## Goals / Non-Goals

**Goals:**

- Any number of keys, each revocable alone, with no change to a deployment
  that sets only `PG_API_KEY`.

**Non-Goals:**

- Identifying which client a request came from. The keys are unnamed.
- Reloading keys without a restart.

## Decisions

- **A new `PG_API_KEYS` beside `PG_API_KEY`, not a list in `PG_API_KEY`.**
  The plural name says what the value holds; keeping `PG_API_KEY` as one more
  entry lets production move over at its own pace. `PG_API_KEY` is not split
  on commas, so a key that happens to hold one keeps working as one key.
- **Comma-separated, trimmed, empty entries dropped.** A GCP secret holds one
  string; commas never occur in a generated key. Trimming keeps a trailing
  newline from a secret file out of a key; dropping empties keeps `a,,b` or a
  trailing comma from admitting an empty header.
- **Every key is compared on every request** (`fold` with a non
  short-circuiting `|`), so the time taken does not tell which entry matched.
  Lengths may still differ in time, as before: they are not secret.
- **`ApiKeys` holds `Arc<[String]>`.** The middleware state is cloned per
  request; an `Arc` keeps that a reference count, not a copy of the list.
- **Logs carry only the count** (`ApiKeys(<3 redacted>)` and the start-up
  line), so an operator can tell a key was dropped without seeing one.

Alternative considered: storing SHA-256 digests and comparing digests, so
the configuration holds no usable key. Left out of scope by HOO-2890; the
`ApiKeys` type is the one place it would change.

## Risks / Trade-offs

- [A malformed list, such as a stray space inside a key, silently drops one
  client] → The runbook says to check each client's key with `curl` after a
  change. The start-up line naming how many keys are accepted is at `INFO`,
  which only a server run with `RUST_LOG=info` prints; App Engine sets no
  `RUST_LOG`, so production does not show it.
- [More keys is a little more work per request] → A handful of byte
  comparisons; negligible against a build.

## Migration Plan

1. Deploy the server: with only `PG_API_KEY` set nothing changes.
2. When a second client is added, create the `PG_API_KEYS` secret with the
   Playground's key and the new one, and remove `PG_API_KEY`.
3. Rollback: redeploy the previous server; it reads `PG_API_KEY` only, so set
   that back first if it was removed.
