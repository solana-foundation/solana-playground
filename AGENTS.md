# Agent rules

## Review

| Reviewer | Run when |
| --- | --- |
| `gates-review` | always, except on paths under `client/`, `server/`, and `wasm/`, and on `chore(upstream): sync` PRs |

## Blast radius

| Paths | Tier | Reason |
| --- | --- | --- |
| `.agents/gates/**` | L | merge policy |

Modules: `client-v2/src/{app,widgets,features,entities,shared}/*`, `client-v2/api`, `server`, `wasm`.
Spread: more than 3 modules is at least M.
