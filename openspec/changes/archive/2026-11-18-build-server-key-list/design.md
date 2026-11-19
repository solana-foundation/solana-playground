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
  The plural name says what the value holds. `PG_API_KEY` is a fallback, read
  only while `PG_API_KEYS` holds no key, so production moves over at its own
  pace. The two never combine: a key in both would survive removing its list
  entry. `PG_API_KEY` is not split on commas, so a key that happens to hold
  one keeps working as one key.
- **A variable set without a usable key stops the server.** Either variable
  set but empty after trimming, a key with a space or a character outside
  visible ASCII (which no request can send, such as a list separated by
  newlines), or a value that is not UTF-8 is an error at start that names the
  variable and no key. Open needs both unset: whoever set one meant the
  routes guarded.
- **Comma-separated, trimmed, empty entries dropped.** A GCP secret holds one
  string; commas never occur in a generated key. Trimming keeps a trailing
  newline from a secret file out of a key; dropping empties keeps `a,,b` or a
  trailing comma from admitting an empty header.
- **Every key is compared on every request** (`fold` with a non
  short-circuiting `|`), so the time taken does not tell which entry matched.
  Lengths may still differ in time: a caller can learn how many keys share
  the length it sent. Keys made by `openssl rand -hex 32`, as the runbook
  says, all share one length, which leaves nothing to learn.
- **`ApiKeys` holds `Arc<[String]>`.** The middleware state is cloned per
  request; an `Arc` keeps that a reference count, not a copy of the list.
- **Logs carry only the count** (`ApiKeys(<3 redacted>)` and the start-up
  line), so an operator can tell a key was dropped without seeing one, where
  `INFO` is printed (see Risks).
- **An open server logs at `ERROR`.** `log::init` filters from `RUST_LOG`,
  which App Engine leaves unset, so only `ERROR` reaches its logs.

Alternative considered: storing SHA-256 digests and comparing digests, so
the configuration holds no usable key. Left out of scope by HOO-2890; the
`ApiKeys` type is the one place it would change.

## Risks / Trade-offs

- [A list that parses but omits a client's key, such as a deleted entry
  meant to stay] → The runbook says to check each client's key with `curl`
  after a change. The start-up line naming how many keys are accepted is at `INFO`,
  which only a server run with `RUST_LOG=info` prints; App Engine sets no
  `RUST_LOG`, so production does not show it.
- [More keys is a little more work per request] → A handful of byte
  comparisons; negligible against a build.

## Migration Plan

1. Deploy the server: with only `PG_API_KEY` set nothing changes.
2. When a second client is added, create the `PG_API_KEYS` secret with the
   Playground's key and the new one, and remove `PG_API_KEY`. Leaving the
   Playground's key out of the list cuts the Playground off, since
   `PG_API_KEY` is no longer read.
3. Rollback: redeploy the previous server; it reads `PG_API_KEY` only, so set
   that back first if it was removed.
