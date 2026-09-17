# Assistant context

This is what the in-product assistant knows about **itself and this project**.
It is loaded into the assistant's context so that questions like "what is this?",
"how does it work?", "what's the status?" and "what did you decide and why?" are
answered from maintained documents rather than invented.

The panel does not render it: it is context the assistant answers from, not a
page to read.

> **Maintained by hand, for now.** Keep it short and keep it true. When it
> disagrees with `decisions.md`, `product-brief.md` or `codebase-map.yaml`,
> those win and this file is wrong. See `decisions.md` → D6.

---

## What this is

Solana Playground is a browser IDE for Solana programs: write Rust, build,
deploy and test without installing anything. It sits at the top of the official
Solana onboarding funnel — the quickstart on solana.com sends newcomers straight
into it.

We are adding an **AI assistant inside that environment**. Not a chatbot bolted
on the side: an assistant that shares context with the open project and can act
on it — read your files, explain the actual compiler error against your actual
code, propose a patch you apply with one click, then build and deploy.

The distinction that matters: the expensive parts already exist here.
Server-side compilation, deploy to devnet, a test panel generated from the
program's IDL. An assistant in this environment can *act*, not merely advise.

## Why it exists

Today, AI help in the Solana ecosystem arrives **after** the local setup barrier.
The quickstart recommends installing the Solana MCP server or the official coding
agent skill — both useful, both requiring a local environment. The people
Playground exists for are exactly the ones that tooling cannot reach.

There is no AI assistance inside Playground at all: no explanation of errors, no
guidance, no connection to the ecosystem's own documentation tooling.

## The plan

Three focus areas, in priority order:

1. **AI assistant inside the environment** — a chat module beside the editor that
   shares project context and can act on it. *Shipped.*
2. **Real wallet support** — standard wallet adapters (Phantom, Solflare,
   Backpack) alongside the existing in-browser keypair.
3. **Modern, responsive interface** — current visual language, works on tablet.

Later candidates: aggregating existing learning material into the environment;
integrating with Blueshift rather than duplicating it; gist import/export; a
faster path for running snippets.

The assistant is grounded in the ecosystem's own sources — the Solana Developer
MCP for documentation, the official Solana skill — with a channel for plugging
in new MCP servers and skills, so the environment inherits ecosystem knowledge
without waiting for a release. The Explorer MCP for on-chain lookups sits
behind bot protection, so it ships disabled and stays that way until whoever
runs the deployment configures its bypass secret on the server.

## Principles we hold ourselves to

- **Propose automatically, apply explicitly.** Anything that changes state —
  files, builds, transactions — requires a human action.
- **A default backend, or bring your own key.** The deployment may configure a
  backend so there is nothing to enter; every other option runs on a key the
  user supplies. Never an open unlimited endpoint.
- **Traceability.** A record of what the assistant did and on what basis.
- **Open by default.** The client and any service integrated into it stay public.
- **No backend changes.** The build server, crate list, deploy mechanics and
  sharing infrastructure are out of scope. Conversation and project sync is
  the exception, and it is additive: new `api/*` routes and a Postgres of our
  own. The build server and its database are still untouched.

## How it works, technically

The assistant runs **in the browser**, with two exceptions, both small routes
we deploy alongside the client. The MCP gateway (`client-v2/api/mcp.mjs`)
forwards MCP JSON-RPC to a fixed list of documentation servers and nothing
else — no model calls, no key, no quota, no state. The default backend
(`client-v2/api/agent.mjs`) is where a model call does leave the browser: it
forwards a chat-completions turn to an upstream configured server-side, so the
key stays off the client. Every tool that touches your project still runs in
the browser, behind the same approval gates. See `decisions.md` → D19.

- The providers share one vendor-neutral tool set (`createTools()`): the
  default backend (whatever this deployment configured, reached through
  `/api/agent`), Anthropic (`claude-opus-5` via `@anthropic-ai/sdk`'s Tool
  Runner), and an OpenAI-compatible chat-completions provider with ready-made
  presets for OpenRouter and Gemini. The Anthropic provider is implemented but
  has not yet been exercised against a live key.
- The tools map onto the playground: read and list files, read the last build
  error, write a file, build, deploy. The gate lives inside each
  state-changing tool's own `run` — `write_file`, `build` and `deploy` each
  `await PgAssistant.requestApproval(...)` and do not return until the user
  clicks, which holds the agent loop open. That is how "propose automatically,
  apply explicitly" is enforced in the loop itself, identically for every
  provider, rather than by the Tool Runner inspecting a call before it runs.
- Project context comes from what the client already holds: `PgExplorer` for
  files and the open tab, `PgProgramInfo` for the IDL and program ID,
  `PgGlobal` for build and deploy state. Every turn carries the whole file
  list, the open tabs by name, and the active tab in full; any other file is a
  `read_file` away. The row above the composer names exactly that.
- The panel is a new sidebar page, so it sits beside the editor without covering
  it, and it is the page the app opens on.
- You stay in control of a turn: the backend is named above the chat and can be
  changed without losing the conversation, **Stop** ends a turn in flight (and
  denies anything waiting on your approval), and when a reply describes an edit
  in prose instead of writing it, **Make this change** asks for the same edit as
  a patch — which still arrives as a diff you accept or reject. Inside a lesson
  step it reads **Write it for me**, because taking it skips the rest of the
  hints. See `decisions.md` → D14.

**One gap we had to close.** The client did not keep the compiler's output
anywhere — the raw `stderr` was printed to the terminal and discarded, leaving
only a `lastBuildFailed` boolean. Explaining a real error needs the compiler's
real words, so the build command now stores it. See `decisions.md` → D4.

## Status

**The assistant panel is shipped.** Hit build, get an error, the assistant
explains it against the actual code, proposes a fix, you apply it with one
click, build succeeds, deploy to devnet, result linked in Explorer — the
milestone demo works end to end.

Done:

- Repository mapped and verified — `codebase-map.yaml` records how the client
  actually works, with file paths, and was checked by running it, not by reading
  alone.
- Local development unblocked: the client would not install until six Rust→WASM
  packages were compiled (~1 hour). They are behind lazy imports and none are on
  the UI boot path, so `wasm/stub-packages.sh` stands them in and setup is now
  about three minutes.
- Verified the client runs standalone against the public build server
  (`https://api.solpg.io`) — CORS allows `http://localhost:3000` and a real build
  returned in 3.5 seconds. No Docker, no Rust toolchain needed.
- Runtime and architecture decided and written down (`decisions.md`).
- The assistant panel: the default backend needs no key and is preselected
  when the deployment configured one; Anthropic, and OpenAI-compatible with
  ready-made OpenRouter and Gemini presets, are selectable. The Anthropic
  provider has not yet been exercised against a live key.
- Three redesign iterations shipped: the Solana-brand theme (tokens sourced
  from solana.com, `Solana V2` as the fork's default), the floating-panel
  layout (anatomy and navigation built on top of it), then **Flow** —
  re-anatomizing the UI around the Write → Build → Deploy → Interact loop
  (`decisions.md` → D10, D17). Flow is now the default layout: a header
  stepper (Write → Build → Deploy → Interact, state derived from real
  build/deploy events) plus a two-tab left panel (Projects | Files), a
  permanent assistant column, and the terminal moved into a console drawer
  (Cmd+J). A New Workspace gallery starts a project from 34 upstream
  programs or 16 tutorials. A gear icon opens a settings overlay embedding
  the existing settings registry. The previous floating-panel layout stays
  reachable at `/?classic` as a fallback.
- Deploy history is new: a client-side store in `localStorage`, keyed by
  workspace, that records each real deploy as it happens.
- Conversations and project code are persisted. Threads are keyed by project
  or tutorial, kept in IndexedDB on the device, and synced to Postgres when
  signed in. A restored thread is history the model can read back, not a
  resumed session: the provider is re-seeded from the text of the
  conversation, and the tool calls behind it are not replayed.

Ecosystem grounding shipped: skills the model loads on demand
(`list_skills` / `load_skill` / `read_skill_reference`), and MCP tools — both
working on every backend, configured in the panel's Sources tab. MCP no longer
needs an Anthropic key: the Solana Developer MCP is reached through a gateway
we deploy with the client, and its tools can be called from a console with no
model connected at all. The `tools/list` and `tools/call` round trips are
verified against the live server; what has not been exercised is a full turn
where a *model* chooses to call one, since that needs a key.

Not started: real wallet adapters; responsive/tablet layout.

## What is real and what is mocked

Honesty rule for the demo — never present a mocked step as working.

- **Real:** the editor, file explorer, terminal, build against the build
  server, compiler stderr capture, deploy to devnet, the IDL-driven test
  panel, the wallet. All of it is the existing playground.
- **Real:** the build server. It is the Solana Foundation's deployment, not
  upstream's `api.solpg.io`.
- **Real:** the assistant's tool calls, the diff it proposes, Apply, and the
  Explorer link after a deploy.
- **Real:** the skills — fetched from the Foundation's own repository at
  `raw.githubusercontent.com`, not copies bundled and left to rot. Only the
  playground-environment skill is bundled, so something always loads offline.
- **Real, behind a capability probe:** conversation and project sync. The
  client asks `/api/sync` whether the deployment has a database and stays
  purely local when it does not, so signing out or deploying without one
  changes nothing about how the playground works.
- **Still prototype-grade:** the default backend has no cost gate.
- **Real, with a gap:** deploy history. It is a genuine client-side store,
  not seeded or scripted, and records every real deploy — but not the
  transaction signature yet, because the deploy command it hooks into
  returns no signature to record.
- **Honest wording, not new work:** "Generate IDL" on the Build surface
  reveals and downloads the IDL a successful build already produced; it
  does not generate anything the build did not already output.
- **Not view-only:** the New Workspace gallery's ecosystem program cards
  import from GitHub through upstream's own mechanism (`PgGithub.import`)
  into a normal, editable project -- they open as a normal project; those
  targeting Anchor newer than the pinned 0.29 will not compile on this build
  server.
- **Not yet verified live:** a full deploy round-trip through Flow. Devnet
  airdrops returned 429 (rate limited) during this pass, so the demo wallet
  needs to be pre-funded ahead of a live run rather than airdropped on
  demand.
- **Real, on every backend:** the Solana Developer MCP tools, including
  `program_autofixer`. That server sends no CORS headers, so a page cannot call
  it; our gateway does, which means the tools work with no Anthropic key at all
  — including in a console with no model connected. The Explorer MCP goes
  through the same gateway and stays off unless the deployment configures its
  bypass secret; you cannot switch it on from the panel alone. Which applies is
  a property of each server, shown in the Sources tab, not of the backend you
  picked.
- **Mocked / stubbed:** Rust intellisense and the `solana`, `anchor`,
  `spl-token`, `sugar` terminal commands — stubbed out to skip the hour-long
  WASM build. They throw a clear message pointing at `wasm/build.sh`.
- **Prototype-grade:** the assistant's key handling — kept in memory only,
  re-entered per session, never written to storage — and the default backend's
  complete absence of a cost gate: anything that reaches our origin can spend
  the configured key, so it needs a challenge and a per-session limit before it
  points at a paid account.

## Answering questions about this project

When someone asks what this is, what is planned, how it works, or why it was
built this way, answer from this file and from `decisions.md` — those are the
maintained sources.

Lead with the outcome, then the supporting detail. Be concrete: name the actual
mechanism rather than gesturing at it. If something is not built yet, say so
plainly — the credibility of the whole demo rests on not overclaiming.

If you do not know, say you do not know and point at the document that would
have the answer.
