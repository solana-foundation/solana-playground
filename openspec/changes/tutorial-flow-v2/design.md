# Design

## Context

The "from" side, on `new-face-polish-2` at `bdd350ba7`:

- **Tutorials:**
  - `client-v2/src/tutorials/tutorials.ts` lists 16 tutorials: 13 are Markdown
    pages from `client/public/tutorials`, and 3 are custom React tutorials
    (`hello-anchor`, `hello-seahorse`, `hello-solana`);
  - `PgTutorial` (`client-v2/src/utils/tutorial/tutorial.ts`) stores the page
    and completion in `.tutorial.json` and a free-form store in
    `.workspace/tutorial-storage.json`;
  - levels are Beginner (9), Intermediate (6) and Advanced (1).
- **Lesson layer (`client-v2/src/views/flow/lessons/`):**
  - an objective band, a step rail, a reader over the Markdown page, and a
    phone bar;
  - an event-log store (`PgLesson`) under the key `lesson` in
    `tutorial-storage.json`;
  - mechanical step checks (`VerifyCondition`: `build-passes`, `deployed`,
    `idl`, `read`, in `lessons/types.ts` and `verify.ts`);
  - only `lessons/paths/hello-anchor.ts` has a path.
- **The assistant** (`client-v2/src/widgets/assistant/`) is a separate panel. It
  reads the lesson through `views/sidebar/assistant/bridge/lesson-context.ts`
  and offers fixed lesson suggestions (`SUGGESTIONS.lesson`) and a "Step n of
  m" chip.
- **Runs:**
  - build: `commands/build/build.ts`, through `PgServer.build` to the
    settings' server;
  - deploy: `commands/deploy/deploy.ts`, through the BPF upgradeable loader,
    with `airdrop-top-up.ts` for funding;
  - Explorer URLs: `views/flow/stages/Deploy.tsx` builds them for the
    explorer and cluster the settings pick;
  - IDL form: `views/sidebar/test/`, embedded in the Interact stage;
  - no Kora code exists.
- **Tutorials page:** `openspec/changes/tutorials-gallery-stand` holds the
  heading, search, filter, Start here banner and level groups as tasks 3.1 and
  3.2, still open.

The "to" side is Almaz's prototype (`almaz/mobile-tutorial-prototype`,
`design-system/src/prototype/tutorial-v2`, `fb4b8e9ee`) and its `SPEC.md`. The
prototype wins where they differ. The differences went to Almaz as a question
batch (`questions-for-almaz.md`); he answered all 34 on 28 Oct, and the specs
carry his answers. Nikita's "Spec 00 · Index and open decisions", in its decision D3, lists
seven places where this change differed from those answers. Each is folded
in: the Call panel's one form with chips (D11); "What is devnet SOL?" and the
wallet strings (D6); only four fixed assistant tools (D2); typed "I'm stuck"
posting the hint (D2); Explorer placement (D9); the "Not enough devnet SOL"
card (D8); doc tabs that close (D10). Almaz's answers are cited as Qn, the
question's number in `questions-for-almaz.md` (his page numbers them 3.n).

## Goals / Non-Goals

**Goals:**

- One tutorial per level runs on the conversation for Breakpoint (11 Nov): Hello
  Anchor, Lumberjack, Zero Copy.
- A product person and an agent can add a tutorial with no code change.
- The work splits into tickets that run in parallel from 28 Oct, with the
  chain format → conversation engine → feed → steps kept short.

**Non-Goals:**

- Moving upstream's other 13 tutorials. They keep their pages.
- A live model writing the lesson. The lesson is scripted; free messages
  reach the model, which acts on the interface only through four tools (D2).
- Kora, a DSL, or the assistant judging a step. An admin panel is not planned
  at all.

## Decisions

### D1. The definition is JSON, checked by a JSON Schema plus a few semantic rules

**Choice:** JSON, with a JSON Schema plus a few semantic rules. This is
Slava's decision of 27 Oct. Product people will write tutorials by talking to
an agent, the agent writes the file by following `AUTHORING.md`, and the file
works as soon as it lands.

**Why JSON:**

- An agent writes JSON reliably.
- A schema gives errors by path that the agent can fix by itself.
- A file in the repo needs no service.

**Publishing:** a tutorial is published through Git. The author's agent
writes the folder from `AUTHORING.md` and the schema, a pull request adds it,
and the merge puts it on the site. There will be no admin panel (Slava, 27
Oct).

**Alternatives:**

- A DSL: Sergey's suggestion, more readable, but it needs a parser and an
  editor story. Not for Breakpoint.
- An admin panel: rejected by Slava, not deferred.

The shape follows the prototype's
`data.ts` (`Step`, `Beat`, `Ask`, `ActBeat`, `Win`, `Chip`), with regex
matches as strings and functions replaced by data. A step's files come as
whole contents at start and at target, so a writer never computes offsets.
Where a block lands is found at run time by placing the block between the
start and the target, as the prototype's `insertBlock` does.

### D2. One thread: scripted turns from the definition, free exchanges from the assistant

**Choice:** the feed merges two sources by time.

- **Scripted turns** come from the definition plus the learner's progress. The
  progress is the beat cursor, the resolution of each beat (picks, attempts,
  skipped, typed) and each result's facts (signature, program id, logs, times).
  Copy is never saved, only facts, so a fixed typo shows on reload. Progress is
  saved in `.workspace/tutorial-storage.json` under a new key, `conversation`,
  versioned. Project sync already carries this file.
- **Free questions and answers** are the assistant's own thread for that
  workspace, with its existing storage and chat sync. A tutorial workspace's
  thread runs in a tutorial mode:
  - its tools are reduced to reading files and four interface tools: open
    the menu, post the live question's hint, skip the live question, and
    propose one change as an apply card (Almaz, Q17);
  - its system context holds the tutorial, the step, the objective, the
    last result and the tutorial's doc list, so it can link a page.

There are no scripted answers matched from typed text. Almaz (Q17): the real
assistant answers everything free, and what stays fixed is what does something
in the interface, as tool calls. Only the finish chips keep the definition's
answers.

**Alternative:** one store holding both. It would duplicate the chat's
persistence and sync, which already handle versioning, merges and two devices.

### D3. The conversation engine is headless; the cards are a widget

**Choice:** the engine is a state machine plus a runner with no React in it.
The cards are a widget.

- **Engine:** a reducer over the definition and the progress, plus a runner
  that drives acts through the build, deploy and run commands. It sits in
  `client-v2/src/features/tutorial-conversation/model`, and the step-goal
  checks sit beside it.
- **Cards:** `widgets/tutorial-conversation`. Desktop and phone render the
  same card components.
- **Workspace:** `widgets/tutorial-workspace`, built from the existing editor,
  file tree, terminal and Test form (shown as the Call panel).

This split lets the engine, the cards, the workspace and the runs land as
separate PRs against fixtures.

### D4. Runs reuse the editor's commands; the result facts come from the chain

**Build:** calls the build command and parses the first `error[Ennnn]` and
`--> file:line:col` from the server's output.

**Deploy:**

- calls the deploy command with the tutorial workspace's program keypair, so
  a redeploy is an upgrade;
- funding is the deploy's own airdrop top-up, reported as a stage;
- after a reload, a deploy is recognised by reading the program account's
  last deploy slot against the saved start time.

**Run and calls:**

- the run captures the signatures the wallet signs during it (a scoped hook on
  the wallet's send);
- each signature's logs are fetched from devnet, and the definition's log
  pattern picks the card's large line;
- the call act and the Call panel reuse the Test form's instruction sender.

**Explorer:** the tutorial builds Solana Explorer URLs with `?cluster=devnet`
itself. The existing helpers do not fit: `Deploy.tsx`'s `useBlockExplorer()`
returns whichever explorer the settings pick, and `solana-explorer.ts` takes
the cluster from the current connection.

**Server side:** none expected, since every step above is client-side.
Alexander owns any server change a ticket finds it needs.

### D5. Step checks reuse the lesson layer's logic in the feature slice

A goal is `build` (instructions present), `deploy` (landed) or `call`
(instruction, required non-empty arguments, log pattern, on the program built
from the target). The checks live in the feature slice (D3), reusing the
logic of `VerifyCondition`'s `build-passes`, `deployed` and `idl` from
`verify.ts` rather than extending the lessons type, which D7 deletes; `call`
is new and `read` is dropped. A self-attested step does not
exist in the conversation.

### D6. Prototype copy that names Kora is replaced

The definition carries the copy, so Hello Anchor's definition replaces the
Kora copy with the wallet path. Almaz gave the words string by string on 28
Oct (Q25), and `tutorial-runs` holds them verbatim in "Wallet copy replaces
every Kora line": nine places and the chip "What is Kora?", which becomes
"What is devnet SOL?". The "Why 7 days?" chip and the 7-day note go (Q28),
since closing idle programs was Kora's rule.

### D7. The old lesson layer retires when Hello Anchor moves

The band, rail, reader and phone bar of `client-v2-lessons` serve only Hello
Anchor's path. They are removed in one small PR once Hello Anchor opens in the
conversation, together with `PgLesson`'s store key and its `migrate.ts`.
Learners with an old record start Hello Anchor from its intro. There is
nothing to carry over: the old record holds marks, not code, and the files
stay in the workspace.

Until then (task 2.1 to 3.3) the frame opens once a definition tutorial is
started; its About page with Start stays as it is, since the intro card (3.3)
is what replaces it. In the frame the chat holds the assistant's own thread,
"Start over…" stays disabled (the engine's `init` and its ports are 3.3's),
and the band stays over the editor. The files column, with the lesson's step
rail and "Skip this step", stays beside the stage, held open with no fold
control since the frame has no stage bar to reopen it, until the workspace's
own tree (2.2) takes its place. The frame shows on a wide window only: from 1024
to 1151 px, under the spec's 1152 floor, it shows with the chat at its 360
default, held to 340 if the window leaves the workspace under 560; from 768 to
1023 px, which no source draws, a tutorial keeps today's layout.

### D8. The faucet's limit gets its own card, funding a stage

Funding is an extra first stage on the deploy act card, shown only when the
balance is short; a refused airdrop is a red "Not enough devnet SOL" card with
the balance, the cost, the address row, "Try again" and "Open faucet" (Almaz,
Q26). Its strings sit in `tutorial-runs`.

### D9. Explorer links are the keys themselves

On a result card's meta line the program id and the signature are the links
(a short key with ↗), with no separate Explorer button. A receipt gives every
address row Copy and Explorer. The Call panel keeps its link on the result
line (Almaz, Q29).

### D10. Docs are Markdown pages kept with the tutorial, opened as tabs

**Choice:** each tutorial lists the few doc pages it needs, stored as
Markdown in its folder, shown as a `Docs` folder in the tree and in the
phone's file list, opened as read-only tabs that close, and linked by the
assistant where a page helps (Almaz, Q24).

**Alternative:** the docs sites in an iframe. Those sites refuse to be
framed, and a copy in the repo works offline from the build and goes through
the same pull request as the tutorial.

### D11. The Call panel is one form with instruction chips

The Call panel's instruction picker is a row of chips, one form and one call
button for the picked instruction (Almaz, Q21). The button keeps the
prototype's "Call <instruction>" rather than Almaz's "one Send": Nikita's Spec
00, written after the answers, proposes "Call <instruction>" (see Open Questions), and the prototype draws "Call hello".

## Risks / Trade-offs

- **Real deploys are slower and can fail where the prototype never did:**
  airdrop limits, build server latency, devnet congestion. This puts the
  60-second first green build at risk.
  - Mitigation: stages show progress, failures have their own cards and
    retries, and e2e runs against devnet as an `env` case.
- **A live assistant can contradict the script.**
  - Mitigation: the tutorial mode's context holds the step and its objective,
    and its tools cannot write or run; the four interface tools only do what
    the lesson's own buttons do. The hint is the definition's text, so it
    works without a model.
- **The thread merge (D2) touches chat persistence, the riskiest code in the
  fork.**
  - Mitigation: the scripted side writes only `tutorial-storage.json`, and the
    assistant side uses its thread unchanged. Merging happens only at render.
- **Lumberjack's energy refills over time,** and Zero Copy's accounts are
  large: deploy and account rent cost more SOL, and a step may need to wait.
  - Mitigation: their content tickets confirm the costs on devnet first. A
    step that waits shows the wait as an act stage.
- **Almaz delivers the Lumberjack and Zero Copy scripts by Fri 30 Oct**
  (Q34), in the prototype and in Hello Anchor's shape. Their content tickets
  wait for those scripts, not for code.

## Migration Plan

1. The definition format, the engine and the frame land first. Hello Anchor
   runs in the conversation behind its definition, while the old lesson still
   serves it.
2. When Hello Anchor's definition opens the conversation on the integration
   branch, the old lesson layer is removed (D7).
3. Rollback: delete a tutorial's `tutorial.json`. Hello Anchor then falls back
   to upstream's pages, since the old lesson is gone by then.

## Open Questions

Open with Almaz, from Nikita's Spec 00. Until answered, the specs hold the
value after the arrow.

- When the Call panel's chips become a dropdown ("only if a program has
  many"). Nikita proposes from seven instructions, or when a row does not fit
  at 320 px. → chips.
- "Send" or "Call <instruction>" on the Call panel's button (D11). →
  "Call <instruction>", as drawn.
- The tree's dock pin hides under 1100 px of workspace (`SPEC.md`, the
  prototype's `Workspace.tsx`), which a 1440 px window with the chat at 420 px
  never reaches (968 px), so docking is out of reach on most laptops. →
  1100 px, as drawn.
- The intro note's wording (Q25): Nikita proposes "A Playground wallet is
  set up for you with free devnet SOL. Your progress stays in this browser".
  → Almaz's string, verbatim.
- "Your progress stays in this browser", in both versions, is true only
  signed out: project sync carries progress to the learner's other devices
  (D2). → Almaz's string, verbatim; asked whether to word it for both.
