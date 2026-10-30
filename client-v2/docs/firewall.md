# Firewall

The Vercel Firewall rules for client-v2 live in the project's **Firewall** tab on Vercel, not in this repository.
This page lists the rules that tab must hold, with the reason for each. Never add tokens, project or team ids, or the
Protection Bypass for Automation secret here.

The application decides who may call each route. `POST /api/agent` answers only a signed-in user from our own origin
([`api/agent.mjs`](../api/agent.mjs)) and holds each one to a daily spend cap
([Default backend spend](deploy-client-vercel.md#default-backend-spend)), the sync routes need a session too, and `/api/mcp` offers its Explorer upstream
only to a signed-in user. The firewall adds what the application cannot: a cap on how fast one client sends requests,
and an emergency switch that needs no redeploy.

## Before configuring

- **Bot protection.** Check the managed rules (Bot Protection, AI Bots) first. Every `/api/*` request these rules
  cover is a `fetch` from the page itself, so a challenge on one breaks the app for real users. If bot protection is
  on, confirm the panel still loads, signs in and answers before adding the rules.
- **Rewrites.** Unverified: that the firewall matches the path the browser sent, before `vercel.json` rewrites
  `/api/auth/sign-in/social` to `/api/auth`. `Rate limit sign-in (IP)` depends on it. Check with the loop in
  [Verifying](#verifying) against `/api/auth/sign-in/social`.
- **Order.** A rate limit must come before any `Bypass` for the same path in the dashboard list, or the bypass ends
  evaluation before the limit is counted.

## Rules to configure

Rules named `[EMERGENCY]` are created disabled. Switch one on during an incident and off again afterwards. Names lead
with what the rule does, so the dashboard list shows the emergency switches without opening each rule.

| Rule | Covers | Without it |
| --- | --- | --- |
| `Rate limit /api/agent (IP)` | `/api/agent` | One signed-in account, or a script holding its cookie, spends its whole daily cap on the paid model key as fast as it can send |
| `Rate limit /api/mcp (IP)` | `/api/mcp` | Anyone relays requests to `mcp.solana.com` through our functions, unmetered |
| `Rate limit sign-in (IP)` | `/api/auth/sign-in/` | A script starts GitHub OAuth flows without limit |
| `Rate limit sync (IP)` | `/api/projects`, `/api/conversations` | A signed-in script writes to Postgres as fast as it can send |
| `[EMERGENCY] Deny /api/agent` (disabled) | `/api/agent` | Stopping spend on the model key needs a redeploy without `AGENT_API_KEY` |
| `[EMERGENCY] Rate limit /api/agent (JA4)` (disabled) | `/api/agent` | No lever against a client rotating IPs faster than the IP limit sees |

The limits in [Rate limits](#rate-limits) are starting values. Read each rule's traffic in the Firewall overview after
a week and adjust it, recording the new value and the reason on this page.

The `/api/agent` rules match `^/api/agent(\.mjs)?$`. Unverified: whether Vercel also serves the function at
`/api/agent.mjs`; the pattern covers that path either way.

## Rate limits

Every rate limit uses the Fixed Window algorithm and answers `429` once a client passes its limit.

| Rule | Limit | Key |
| --- | --- | --- |
| `Rate limit /api/agent (IP)` | 30 req/60s | IP |
| `Rate limit /api/mcp (IP)` | 60 req/60s | IP |
| `Rate limit sign-in (IP)` | 20 req/60s | IP |
| `Rate limit sync (IP)` | 300 req/60s | IP |
| `[EMERGENCY] Rate limit /api/agent (JA4)` | 30 req/60s | JA4 |

```text
Name: Rate limit /api/agent (IP)
Description: 30/60s per IP, 429 over the limit. Each request is one model turn on the paid key, and a turn that calls tools sends several. Signed-in users only, each held to a daily spend cap by api/agent.mjs; this limits how fast, the cap how much. ^/api/agent(\.mjs)?$
Status: Enabled
Rule:
    If `Request Path` `Matches expression` `^/api/agent(\.mjs)?$`
    AND `Rate Limit`
        Strategy: Fixed Window
        Window: 60 seconds
        Limit: 30 requests
        Keys: IP Address
    Then `Too Many Requests (429)`
```

A tool loop sends one request per step, so 30 a minute allows a few long turns a minute from one person and stops a
script. Shared IPs (an office, a VPN) share the bucket; raise the limit before exempting anyone.

```text
Name: Rate limit /api/mcp (IP)
Description: 60/60s per IP, 429 over the limit. Open by design: bring-your-own-key users call it signed out. Each request is a function invocation relayed to mcp.solana.com. ^/api/mcp$
Status: Enabled
Rule:
    If `Request Path` `Equals` `/api/mcp`
    AND `Rate Limit`
        Strategy: Fixed Window
        Window: 60 seconds
        Limit: 60 requests
        Keys: IP Address
    Then `Too Many Requests (429)`
```

`/api/mcp` stays open to signed-out users on purpose. It holds no paid key, and every backend's tools, the
bring-your-own-key ones included, reach it while signed out; a sign-in check on the whole route would remove the Solana
tools from those users with only a console warning. Its one secret is `MCP_EXPLORER_BYPASS`, which forwards our
Protection Bypass to the Explorer deployment. [`api/mcp.mjs`](../api/mcp.mjs) offers the Explorer upstream only to a
signed-in user, so the bypass never reaches an anonymous caller.

```text
Name: Rate limit sign-in (IP)
Description: 20/60s per IP, 429 over the limit. Each request starts a GitHub OAuth flow. get-session is not covered: the app calls it on every load. ^/api/auth/sign-in/
Status: Enabled
Rule:
    If `Request Path` `Starts with` `/api/auth/sign-in/`
    AND `Rate Limit`
        Strategy: Fixed Window
        Window: 60 seconds
        Limit: 20 requests
        Keys: IP Address
    Then `Too Many Requests (429)`
```

```text
Name: Rate limit sync (IP)
Description: 300/60s per IP, 429 over the limit. Signed-in reads and writes against Postgres, loose until the rule's traffic says otherwise. ^/api/(projects|conversations)$
Status: Enabled
Rule:
    If `Request Path` `Matches expression` `^/api/(projects|conversations)$`
    AND `Rate Limit`
        Strategy: Fixed Window
        Window: 60 seconds
        Limit: 300 requests
        Keys: IP Address
    Then `Too Many Requests (429)`
```

Unverified: how the sync client handles a `429` from these routes. Before tightening this limit, answer a `429` from
`/api/projects` in a browser session and check that no local work is lost.

```text
Name: [EMERGENCY] Rate limit /api/agent (JA4)
Description: Disabled by default. 30/60s per TLS fingerprint, 429 over the limit, for abuse that rotates IPs. Everyone on the same browser build shares a JA4 bucket, so it also slows real users. ^/api/agent(\.mjs)?$
Status: Disabled
Rule:
    If `Request Path` `Matches expression` `^/api/agent(\.mjs)?$`
    AND `Rate Limit`
        Strategy: Fixed Window
        Window: 60 seconds
        Limit: 30 requests
        Keys: JA4 Digest
    Then `Too Many Requests (429)`
```

## Emergency switches

```text
Name: [EMERGENCY] Deny /api/agent
Description: Disabled by default. Turns the default backend off for everyone without a redeploy. Switch on when spend on the model key spikes; off once the cause is fixed. ^/api/agent(\.mjs)?$
Status: Disabled
Rule:
    If `Request Path` `Matches expression` `^/api/agent(\.mjs)?$`
    Then `Deny (403)`
```

The rule denies the panel's probe (`GET /api/agent`) too, so the panel reports the default backend as unavailable and
offers the bring-your-own-key backends, rather than accepting a question and failing on it.

During an incident:

1. Switch on `[EMERGENCY] Deny /api/agent` and publish.
2. Check in the model provider's dashboard that spend has stopped.
3. Find the source in the Firewall overview, grouped by the rule, then by IP or JA4.
4. Fix the cause: lower a limit, block the source, or rotate `AGENT_API_KEY` if it leaked.
5. Switch the rule off and publish. The Firewall's Audit Log holds each change if one has to be undone.

## Verifying

A single request shows whether a rule acted on it:

```sh
curl -s -o /dev/null -w '%{http_code} %header{x-vercel-mitigated}\n' https://<origin>/api/agent
```

`200` with an empty header is a request no rule acted on. This loop passes the agent limit, so its last requests
answer `429`, and the Firewall overview lists them under the rule's name:

```sh
for i in $(seq 1 40); do
  curl -s -o /dev/null -w '%{http_code} %header{x-vercel-mitigated}\n' https://<origin>/api/agent
done
```

The same rules can be created from the command line with
[`vercel firewall rules add`](https://vercel.com/docs/cli/firewall). The dashboard stays the source of truth: after
adding a rule either way, check it there and keep this page in step.
