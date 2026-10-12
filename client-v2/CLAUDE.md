# client-v2: frontend rules

@AGENTS.md

`client-v2` moves to a design system built on Tailwind 4, shadcn/ui on Radix
and React 19 through the OpenSpec change `ui-migration` (see "Specs and
changes"). These rules say where new code goes and when old code moves. They
apply to everyone working in this folder, people and agents alike.

`client-v2` is not synced with upstream's frontend. Edit any file here as the
work needs. Something wanted from upstream comes in as a feature with its own
ticket. `client/` stays byte-identical to upstream; never edit it.

## Layers

New code lives in five layers under `src/`, and a layer imports only from
the layers below it. This is feature-sliced design (FSD) with the `pages`
layer left out:

```
app -> widgets -> features -> entities -> shared
```

- **`app`**: startup, providers, the top-level layout. `src/app/` holds the
  panel tree and is the app layer.
- **`widgets`**: a composed part of the screen, such as a panel or a bar.
  There is no `pages` layer: on a one-screen IDE, widgets play that role.
- **`features`**: one user action with its own state, such as signing in or
  syncing a project.
- **`entities`**: a domain object and what reads it, such as a project or a
  conversation.
- **`shared`**: no domain knowledge. `shared/ui` holds design-system
  components, `shared/lib` helpers and `shared/lib/hooks` hooks.

Two rules on top of the direction:

- **A feature never imports another feature.** When two features must meet,
  they meet in a widget that imports both. One named exception exists today:
  `auth` and `persistence` import each other (`auth`'s server module uses
  `persistence`'s pool; `persistence` reads the session). It is recorded as
  the exception in the `client-v2-layers` spec and is broken by task 1.4 of
  `ui-migration`; the boundary check (HOO-1859) exempts these two until then.
- **Entities do not import each other.** FSD's `@x` cross-imports are not
  enabled.

A slice's segments: `ui/` for React, `model/` for logic, `lib/` for leaf
helpers. Its public API is `index.ts` for browser code and `server.mjs` for
`api/` routes; import a slice through its public API, never a deep path.

**Every slice with an `index.ts` measures itself.** Under `features/` and
`widgets/`, it declares its events in `model/telemetry.ts` with
`createTracker` from `shared/lib/telemetry`, registers its prefix in
`shared/lib/telemetry/prefixes.ts`, and gives every event a doc comment saying
when it fires. `src/app/slice-structure.test.ts` fails otherwise. A change that
adds or renames an event describes it in its spec delta too
(`openspec/config.yaml`). Logs go through `shared/lib/logger`: a slice binds
its own namespace with `createLogger("<slice>:<module>")`.

The two existing features with a React folder, `auth` and `persistence`, keep
`Component/` until the naming is settled; new slices use `ui/`.

**Legacy roots.** `components/`, `views/`, `utils/`, `hooks/`, `providers/`,
`commands/`, `effects/` and the other pre-existing roots sit outside the
layers. New code may import from them. Do not add new UI to them. The
boundary check ignores them.

## Components

**Install before you build.** When the design system has a component, install
it into `shared/ui`. Do not rewrite it.

**Our own components come in pairs:**

- `Base<Name>` is built from design-system parts and takes everything through
  props. It renders with no store, no explorer and no network.
- `<Name>` wraps `Base<Name>` and connects the data.

Both live in the slice that owns the data, under `ui/`. Design-system
components keep their shadcn names and never get the `Base` prefix.

**`shared/ui` is installed, never edited by hand.** A change to a shared
component is made in the design system and reinstalled, which overwrites the
installed files:

```sh
yarn ds-add stepper callout     # install or reinstall, by registry name
yarn ds-add stepper --dry-run   # what would be written; --diff, --view too
```

The script builds the registry in `../design-system` (run `npm ci` there
once, and again whenever its lockfile changes), serves it on the port
`components.json` maps `@playground` to for as long as the install runs, and
formats what lands with this package's prettier. Names are the registry's
(`design-system/registry.json`); `components.json` maps `@playground` to that
server and the aliases to `@/shared/ui`, `@/shared/lib` and
`@/shared/lib/hooks`. Nothing comes from the design system's public site
or from `ui.shadcn.com`: the stock shadcn parts are registry items too, and
`scripts/registry.test.mjs` fails on a dependency named outside
`@playground/`. The components' npm dependencies are added to
`package.json` from npm.

The hand-written `GradientButton` is not in `shared/ui`: it lives in
`components/GradientButton`, beside the legacy `Button` it wraps, until the
design system's brand button replaces both.

One exception: the design system's components named after product parts
(the catalogue lists them: composer, console drawer, step rail and the rest)
are installed into `shared/ui`. They only draw what they are given; their
connected versions live in the slice that owns the data.

## What survives every move

Ids, `aria-label`s and test ids do not change when code moves: the tests and
the design tooling find elements by them. Design-system components bring
their `data-slot` names; keep them.

Parts of the file explorer's tree are driven directly in the DOM by
`src/utils/explorer/explorer.ts`. That module itself is never moved (below);
the explorer's React components may move, but they keep their element
structure, not only the ids.

## The UI move rule

Apply it to every edit that touches UI:

```
New component or screen?
  yes -> the design system has it? install it : build a Base + connected pair
  no  -> will the edit show, and is it designed?
           no, or no design yet -> fix in place (no design yet: file a design ticket)
           yes -> used in 3 places or fewer, and imports no other UI of ours?
                    yes -> move it whole, in its own commit
                    no  -> extract a Base beside it; the old wrapper stays
```

Never moved along the way:

- the Monaco and xterm internals;
- the runtime modules: `src/utils/js-runtime`, `src/utils/explorer`,
  `src/commands/`;
- code under an open ticket that has a deadline.

When a move is right but costs too much now, say so and propose a ticket
instead of making it. Code that is not UI (a hook, a command, a route) follows
the layers only when it is new.

## Specs and changes

Planning runs through [OpenSpec](https://openspec.dev). `../openspec/`
holds what the client does (`specs/`) and what we are changing
(`changes/`); `openspec/config.yaml` carries the project constraints every
command below reads. The `/opsx:*` commands are committed in `.claude/`, so
they are available in every session on this repository. The CLI itself is
installed once per machine (`client-v2/README.md`, "Planning tools"); the
`spec:validate` script runs the pinned copy, and only that copy's verdict
counts.

1. **Think first, with the brainstorming skill.** Anything that changes
   behaviour or touches more than one slice starts as a conversation, not a
   file: `superpowers:brainstorming` for the shape of the work (or
   `/opsx:explore` to read an unfamiliar area of the code first). A bug fix
   with a ticket skips this; the ticket is its proposal. For a feature or a
   widget, the conversation includes its telemetry: propose the events
   (the user's actions there, how each can fail) and the namespace it logs
   under, unprompted, and let the user confirm or trim them.
2. **`/opsx:propose <kebab-name>` writes the change.** It creates
   `openspec/changes/<name>/` with `proposal.md`, the delta specs under
   `specs/<capability>/spec.md`, `design.md` and `tasks.md`, from the
   schema's templates and `config.yaml`'s rules. Do not hand-write these
   files; if one needs changing, `/opsx:update`. The brainstorm's
   conclusions go into the proposal through the command, not beside it.
3. **The proposal is reviewed as a PR before code.** A small change may
   share the PR with its code; a change that needs agreement lands as a
   docs-only PR first. The `spec:validate` script must pass; CI runs it.
4. **`/opsx:apply` implements, one task per PR.** It reads `tasks.md`,
   works a task, ticks it. Tick a task only in the PR that lands it, and
   name the task in the PR description. The ordinary PR checklist (section
   "Before a PR") still applies to every task.
5. **A human closes the change.** When the last task is ticked, the agent
   stops and asks whether to close the change; it never runs
   `/opsx:archive` unasked. On a yes, delete `tasks.md`, then
   `/opsx:archive` merges the deltas into `openspec/specs/` and moves the
   folder to `changes/archive/<date>-<name>/`. `specs/` therefore always
   describes the code as it is, never a plan; nothing is back-filled for
   code that is not changing.
6. **Asked to build something, look in `openspec/changes/` first**
   (`openspec list`). If a change covers it, `/opsx:apply` that change and
   say which task. If none does and the work is more than a bug fix, offer
   `/opsx:propose` rather than starting on the code. A bug fix in a slice
   that sends no events, or none for the path being fixed, says so and
   proposes the missing events as a follow-up ticket.

**Where the superpowers skills write.** Their default locations
(`docs/superpowers/specs/`, `docs/superpowers/plans/`) are not used in this
repository; OpenSpec is the place. The skills take a project's location as
an override of their default, and this section is that override:

- `superpowers:brainstorming` ends by running `/opsx:propose`, not by
  writing a design document. What it would have put in the document goes
  into `proposal.md` and `design.md` through the command.
- `superpowers:writing-plans` writes a task's detailed plan, when a task
  needs one, to `openspec/changes/<name>/plans/<task-number>-<slug>.md`.
  `tasks.md` stays a checklist of PR-sized tasks and links the plan from
  the task line. `openspec validate --strict` passes with files under
  `plans/` (checked on 2026-10-05 with CLI 1.14.0).
- `superpowers:subagent-driven-development` and `executing-plans` run
  inside `/opsx:apply`, one task at a time; `test-driven-development` and
  `verification-before-completion` apply to every task as before.
- `superpowers:finishing-a-development-branch` precedes the question
  whether to close the change, for its last task.

**Scenarios are the test plan.** Every `#### Scenario:` in a spec is
either a Playwright test in `e2e/` whose title is
`<capability>: <scenario name>` (for example
`client-v2-themes: A saved Dracula theme`), or a line in a manual checklist
marked `(manual)` in the spec. A manual gate (the React 19 walk-through, a
release check) is the list of scenarios, not a separate document. The
`spec:coverage` script prints every scenario that has neither; `--strict`
makes that an exit code (HOO-1856).

## What review keeps finding

Each rule here came back in review more than once. The first three are
ESLint errors (`package.json` `eslintConfig`, run by `yarn lint`) in the
layers, `src/{app,widgets,features,entities,shared}/`; the legacy roots are
exempt until code moves out of them, except that `crypto.randomUUID` is an
error across all of `src/` and `e2e/`, and the id rule holds in `e2e/`. The
lint catches the common spellings, not every one. The fourth is the boundary
check's job (HOO-1859); the rest hold by review.

- **Ids come from `src/shared/lib/ids`.** `uuid()` mints one, `isUuid()`
  checks one. Never `crypto.randomUUID()`, never a
  copied UUID regex, never `import ... from "uuid"` anywhere else.
  `api/` cannot import `src/`, so it uses the `uuid` package directly;
  it is the one exception.
- **A `catch` is never empty.** It rethrows, logs through `shared/lib/logger`
  (with `report: true` when the team must hear of it in production), or tells
  the user. A failure that is swallowed on purpose still logs why, in the
  `catch`, so the next reader does not have to guess whether it was
  forgotten.
- **No nested ternaries.** Two or more branches is an `if` chain or a
  `Record` lookup.
- **Imports go through a slice's public API**, never a deep path (see
  Layers).
- **A string that two places must agree on is declared once** and exported,
  preferably as a predicate (`isTruncationNotice`), not as a prefix that each
  caller compares by hand.
- **Mock the network through the test runner** (`vi.spyOn`, `vi.fn`), not by
  assigning `global.fetch` in each test. `setupTests.ts` installs a `fetch`
  that throws, so a test that forgets its stub fails instead of reaching the
  network.
- **Do not collapse status codes.** A `429` and a `204` are different
  answers and get different branches. A streamed error is a complete frame
  of its own (`\n\ndata: ...\n\n`), and its test feeds a chunk cut
  mid-frame.
- **Shape state as a type, not as flags.** Four `let`s whose valid
  combinations live in your head are a discriminated union. A result that
  says `skipped` for eight reasons names the reason. A boolean parameter is
  a sign the function wants an options object.
- **A comment names a symbol, never a line number**, and says why, not what.
  When the function changes, its JSDoc is part of the change.
- **One migration per PR**, even while the schema is unshipped. Appending
  to another PR's migration forces everyone on a preview database to roll
  back by hand.
- **On one element and one property, styled-components wins over a Tailwind
  utility** until that component migrates: styled CSS is unlayered, while
  utilities sit in `@layer utilities` and lose the cascade. Do not patch a
  styled component with a utility; change the styled rule, or move the
  component by the UI move rule.
- **Build configuration is not unit-tested.** Guard the outcome instead: CI
  greps the built CSS (or bundle) for what the configuration must produce.
  A test that asserts the shape of `craco.config.js` passes while the build
  is wrong.

## Before a PR

- **A test for a bug fails first.** Run it against the code before the fix
  and put the failing output, or the commit it failed at, in the PR
  description. A test that passes with the fix reverted proves nothing.
- **Infrastructure needs a reproduced problem.** Before building a proxy,
  a fallback or a migration for a problem someone reported, reproduce it
  live (a probe, a curl, a screenshot, dated) and put that in the PR. A PR
  that solves a problem the repository does not have is closed, not fixed.
- **Run the review agents.** `/pr-review-toolkit:review-pr` before
  `gh pr create`. Its agents (the toolkit's README lists them) cover the
  headings every human review here has used: silent failures, type design,
  test coverage, comments. What they find is fixed in the same PR.
- **A stacked PR is rebased** whenever the one under it moves. "Needs a
  rebase" is a review verdict here, not a nit.
- **The `check` script is green before the push.** It runs what CI runs,
  in CI's order, minus the production build. Opt in to running it on every
  push with `git config core.hooksPath .githooks` once per clone.
- **Archiving is a human's call.** After the last task, ask whether to
  close the change (delete `tasks.md`, then `/opsx:archive`). Never
  archive unasked.
- **The browser suite runs in CI** (`yarn test-e2e`, the `e2e` job of
  `client-v2.yml`) on every PR to `master-2.0`, and a red spec fails the
  PR's checks. It needs no server and no Postgres: every spec stubs the account
  endpoints with `page.route`, and the dev server serves `api/*.mjs` itself.
  Two tests connect to the keyless default backend and skip themselves where
  `/api/agent` reports none configured (CI included); they run only on a
  machine with the default backend configured. Two sync tests ("switching
  tabs mid-debounce raises no conflict", "reloading a project the account
  already has writes nothing") are `test.fixme` on the runner, where the
  load's timing differs and the sync races they guard show. The four are
  listed by title in `e2e/known-skips.txt`; the job fails on any skip that
  is not in the list and warns on an entry that no longer skips. D61 (on
  `context-archive`) records them. CI retries a failed spec once,
  because the runner is three times slower than a laptop and fails specs on
  timing alone; a pass on the retry is reported as **flaky**, named in the
  run's annotations, and is work to do, not a pass. Locally `retries` is 0,
  so a flake fails where it gets fixed. Quarantine is an explicit
  `test.skip` or `test.fixme` with the reason in the call, never a retry.
- **A runtime upgrade still gets the manual walk-through** from the UI
  migration spec ("The React 19 gate"), in development and in the production
  build, because the suite runs against the dev server only.
