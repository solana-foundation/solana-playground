# Assistant context

This is what the in-product assistant knows about **itself and this project**.
It is loaded into the assistant's context so that questions like "what is this?",
"how does it work?", "what's the status?" and "why is it built this way?" are
answered from a maintained document rather than invented.

The panel does not render it: it is context the assistant answers from, not a
page to read.

> **Maintained by hand, for now.** Keep it short and keep it true. When it
> disagrees with the code, the code wins and this file is wrong.

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
the browser, behind the same approval gates.

- The providers share one vendor-neutral tool set (`createTools()`) and one
  turn loop: the default backend (whatever this deployment configured, reached
  through `/api/agent`), Anthropic (Claude Opus 5.5 or Sonnet 5.5), and an
  OpenAI-compatible chat-completions provider with ready-made presets for
  OpenRouter and Gemini. Every model call goes through `@/shared/lib/ai`, a
  module of the client built on the Vercel `ai` SDK (`@ai-sdk/anthropic` and
  `@ai-sdk/openai-compatible`); the differences between backends are settings
  passed to that one loop, not separate code. The SDK is loaded on the first
  turn, or when the panel opens if an MCP server is enabled, since the panel
  then lists that server's tools. The Anthropic provider is implemented but has
  not yet been exercised against a live key.
- MCP servers are called from the browser, through `@ai-sdk/mcp` in the same
  module: directly when the host allows a browser to call it, otherwise
  through the MCP gateway (`/api/mcp`). No MCP server is handed to a model
  provider to call on its side; a configuration that still names
  `"executor": "server"` loads, and that server is called from the browser like
  any other.
- The tools map onto the playground: read and list files, read the last build
  error, write a file, build, deploy. The gate lives inside each
  state-changing tool's own `run` — `write_file`, `build` and `deploy` each
  `await PgAssistant.requestApproval(...)` and do not return until the user
  clicks, which holds the agent loop open. That is how "propose automatically,
  apply explicitly" is enforced in the loop itself, identically for every
  provider, rather than by the transport inspecting a call before it runs.
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
  hints.

**One gap we had to close.** The client did not keep the compiler's output
anywhere — the raw `stderr` was printed to the terminal and discarded, leaving
only a `lastBuildFailed` boolean. Explaining a real error needs the compiler's
real words, so the build command now stores it.

## Status

**The assistant panel is shipped.** Hit build, get an error, the assistant
explains it against the actual code, proposes a fix, you apply it with one
click, build succeeds, deploy to devnet, result linked in Explorer — the
milestone demo works end to end.

Done:

- Repository mapped and verified — how the client actually works was checked
  by running it, not by reading alone.
- Local development unblocked: the client would not install until six Rust→WASM
  packages were compiled (~1 hour). They are behind lazy imports and none are on
  the UI boot path, so `wasm/stub-packages.sh` stands them in and setup is now
  about three minutes.
- Verified the client runs standalone against the public build server
  (`https://api.solpg.io`) — CORS allows `http://localhost:3000` and a real build
  returned in 3.5 seconds. No Docker, no Rust toolchain needed.
- Runtime and architecture decided: the assistant runs in the browser, with
  two small routes deployed alongside the client.
- The assistant panel: the default backend needs no key, only a GitHub
  sign-in, and is preselected when the deployment configured one; Anthropic,
  and OpenAI-compatible with
  ready-made OpenRouter and Gemini presets, are selectable. The Anthropic
  provider has not yet been exercised against a live key.
- Three redesign iterations shipped: the Solana-brand theme (tokens sourced
  from solana.com, `Solana V2` as the fork's default), the floating-panel
  layout (anatomy and navigation built on top of it; the classic layout, since
  removed), then **Flow** —
  re-anatomizing the UI around the Write → Build → Deploy → Interact loop.
  Flow is the only layout, a frame of four
  columns with no header. From the left: the navigation (Home, New project,
  Tutorials, Programs, the project list under them, and its session
  footer: a cluster row, which opens the settings on the cluster, and an
  account row whose menu holds sign-in, Settings (Cmd+,), Docs, the feedback
  entries and the wallet; Cmd+B folds it to a rail of icons, whose footer
  keeps the cluster's status dot and an Account button that opens the same
  menu), the
  assistant, then the work area. Across the top of the work area runs the
  stage bar, with the stepper (Write → Build → Deploy →
  Interact, state derived from real build/deploy events); under it sit the
  Files column (Cmd+E folds it; on a Mac not while the editor has focus,
  where the editor takes the key; the column's own button always works)
  and the stage, with the terminal in a console
  drawer under the stage (Cmd+J). The assistant is a resizable panel on
  screens 1024 px and wider and a side Sheet from 768 to 1023 px, where the
  navigation starts as a rail. Below 768 px the app is three swiped
  pages: the navigation, Work (Chat or Code, with Files in a Sheet) and
  Preview (the Build, Deploy or Interact stage over the console); there the assistant is the Chat view
  of Work, not a Sheet. The editor edits at every width. A start with no
  project opens Home ("Where should we begin?"), not a popup. From 768 px
  Home has a composer, New project, Follow a tutorial and Open a program
  tiles, and four tutorial cards; below 768 px it has quick starts (a new
  Anchor project, a beginner tutorial), a Browse button that opens the
  Tutorials page, and the composer. The navigation's Home opens Home from an
  open project too, and deleting the last project lands there; picking the
  open project in the list (or Continue on a phone) goes back to it with the
  editor, its undo history and the console as they were. Tutorials and
  Programs in the navigation (and Home's tiles, and the `/tutorials` and
  `/programs` links) open pages with a search field and cards, over the open
  project, which comes back as it was; opening a card opens the tutorial or
  imports the program. The New Workspace gallery (New project) starts a
  project from scratch, 34 upstream programs or 16 tutorials. The cluster
  row, the account menu's Settings or Cmd+, open Settings as a page of its
  own over the whole window: a list of sections (Network, Project, Block
  Explorer, Build, Connection, Editor, Notification, Server, Test UI, UI,
  Wallet, Experimental) built from the existing settings registry, and "Back
  to app", Escape or Cmd+, to return to the work as it was.
- Deploy history is new: a client-side store in `localStorage`, keyed by
  workspace, that records each real deploy as it happens.
- Conversations and project code are persisted. Threads are keyed by project
  or tutorial, kept in IndexedDB on the device, and synced to Postgres when
  signed in. A restored thread is history the model can read back, not a
  resumed session: the provider is re-seeded from the text of the
  conversation, and the tool calls behind it are not replayed. What the panel
  showed is what comes back — every message, tool line and approval card. The
  model's own reasoning is not stored because it is never shown in the first
  place; the panel renders a working indicator while a turn runs, not the
  reasoning behind it. A card the user never answered comes back marked as
  unanswered rather than declined, and a device that has dropped the oldest
  messages of a long thread says so at the top of it.
- Project code syncs both ways, so signing in on another device picks up where
  the last one left off. Changes from two devices are merged file by file and,
  within a file, line by line; the user is asked only about lines both devices
  changed. Each device records what the server last accepted from it, which is
  what lets a reload tell a local copy that is behind the account from one
  holding work that never finished uploading, and deleting a project
  propagates rather than coming back on the next load.

Ecosystem grounding shipped: skills the model loads on demand
(`list_skills` / `load_skill` / `read_skill_reference`), and MCP tools — both
working on every backend, configured in the panel's Sources tab. MCP no longer
needs an Anthropic key: the Solana Developer MCP is reached through a gateway
we deploy with the client, and its tools can be called from a console with no
model connected at all. The `tools/list` and `tools/call` round trips are
verified against the live server; what has not been exercised is a full turn
where a *model* chooses to call one, since that needs a key.

Not started: real wallet adapters.

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
- **Real, behind sign-in:** the default backend. It answers only a user
  signed in with GitHub; signed out, the panel offers sign-in or a backend on
  the user's own key. There is no per-user spend cap yet.
- **Real, with a gap:** deploy history. It is a genuine client-side store,
  not seeded or scripted, and records every real deploy — but not the
  transaction signature yet, because the deploy command it hooks into
  returns no signature to record.
- **Honest wording, not new work:** "Download IDL" on the Build surface
  saves the IDL a successful build already produced; "Upload IDL" on
  Deploy and Interact replaces the IDL this browser uses -- neither
  generates anything or writes anything on-chain.
- **Not view-only:** the Programs page's and the gallery's ecosystem program cards
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
- **Prototype-grade:** the default backend's spend: sign-in decides who can
  spend the configured key, but nothing yet caps how much one signed-in user
  spends.
- **Real, kept per tab:** your own key. It is kept in the tab's
  `sessionStorage`: a reload keeps it and a new tab asks again, while a tab the
  browser duplicates or restores (a reopened closed tab, a restored session)
  carries it and reconnects, as after a reload. Forget key, in the panel
  head's More menu, removes it. It goes from the browser straight to the provider as a header on
  every request, never through our server, and is never logged or synced.
  Project code runs in the same origin and could read it while the tab is open;
  that is why it is not in `localStorage`.

## Answering questions about this project

When someone asks what this is, what is planned, how it works, or why it was
built this way, answer from this file — it is the maintained source.

Lead with the outcome, then the supporting detail. Be concrete: name the actual
mechanism rather than gesturing at it. If something is not built yet, say so
plainly — the credibility of the whole demo rests on not overclaiming.

Answer "why" only from what this file states. If it does not say, say you do
not know rather than reconstructing a reason.
