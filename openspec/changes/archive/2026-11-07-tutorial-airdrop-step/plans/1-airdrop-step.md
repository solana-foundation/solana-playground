# Tutorial airdrop step: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans
> (inline, the fleet's default) to implement this plan task by task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** an `airdrop` act before the first deploy funds the wallet on a
press, or passes by itself when the wallet is already funded. The deploy
stops airdropping.

**Architecture:** the airdrop runner shares the deploy port and one cost
helper, and calls the existing `fundForDeploy`. The store auto-presses a
funded airdrop card through an optional `Runner.isFunded()` probe. The deploy
answers `no_funds` instead of funding.

**Tech stack:** TypeScript, React, in-source vitest, Playwright e2e.

**Spec:** `openspec/changes/tutorial-airdrop-step/` (proposal, design, and
specs `tutorial-definition` and `tutorial-runs`).

## Global Constraints

- Copy, verbatim:
  - Card title "Get devnet SOL", context "{short address} · {balance} SOL",
    button "Request airdrop".
  - Records "Added {n} SOL" and "Your wallet has {balance} SOL".
  - Retry lines "Asks the faucet again" (airdrop) and "Checks your balance
    again, then deploys" (deploy).
  - Terminal "Airdropping {n} SOL...".
  - Refusal card "Not enough devnet SOL" (`aria-label="Not enough SOL"`).
- The airdrop needs no sign-in.
- Lumberjack is out of this branch.
- Run and call funding is unchanged.
- Telemetry: `tutorial_action_run.action` gains `"airdrop"`. Nothing else
  changes.
- Copy knock-ons from Design alignment, 6 Nov 22:40:
  - Intro note: "A devnet wallet is set up for you, and you get free test SOL
    for it before the first deploy. Your progress stays in this browser".
  - Hello Anchor `s2.why` ends "…It costs devnet SOL, test money with no
    value. You get it from the devnet faucet with one button before the
    deploy, and if the faucet is busy, at faucet.solana.com."
  - The "What is devnet SOL?" answers (both lessons) end "You get it from the
    devnet faucet with one button; if the faucet is busy, get some yourself
    at faucet.solana.com."

## Review Focus

1. **No wallet when the lesson reaches the card.** The probe answers "not
   funded", so the card stays live. Its context reads "A new Playground
   wallet, made in this browser". A press makes the wallet, then airdrops,
   and the record reads "Made a wallet and added {n} SOL" (Design alignment,
   22:41). Tests in Tasks 2 and 3.
2. **A reload on a landed airdrop.** No second auto-press, and no second
   airdrop. The probe only fires for a live, never-run card. Test in Task 3.
3. **A probe that throws (RPC down).** The card stays live and nothing posts.
   The failure is reported, not swallowed. Test in Task 3.
4. **The airdrop landed but the binary outgrew the estimate.** The deploy
   posts `no_funds` with "Checks your balance again, then deploys", and does
   not airdrop. Test in Task 2.
5. **A double press while a probe is in flight.** Only one run starts, because
   the act goes through the reducer's existing in-flight guard. Test in
   Task 3.

---

### Task 1: The definition knows `airdrop`

**Files:**
- Modify: `client-v2/src/entities/tutorial/model/definition/types.ts:79`
  (`Act`)
- Modify: `client-v2/src/entities/tutorial/model/definition/check.ts`
  (per-act rules; a new order rule)
- Modify: `client-v2/src/tutorials/tutorial.schema.json` (the act enum)
- Modify: `client-v2/src/entities/tutorial/model/telemetry.ts:151`
  (`action`)
- Fix the `Record<Act, …>` maps the type check flags.
  `BaseActCard.tsx` `ICONS`: `airdrop: Droplets`. `DONE`: `airdrop: "Funded"`.

**Interfaces:** Produces `Act` including `"airdrop"`. The telemetry
`action` string is `"airdrop"`.

- [ ] Test: `check.ts` refuses a lesson whose first deploy act has no airdrop
      before it, and the error names the deploy act's id. It passes with
      `s2.airdrop` before `s2.deploy`. An airdrop act with `call` fails.
- [ ] Run, see it fail, implement, see it pass. Run `yarn test-types`.
- [ ] Commit `feat(client-v2): tutorial definitions know the airdrop act`.

### Task 2: The airdrop runner; the deploy only checks

**Files:**
- Modify: `client-v2/src/features/tutorial-conversation/model/runners/deploy.ts`
- Create: `client-v2/src/features/tutorial-conversation/model/runners/airdrop.ts`
- Modify: `client-v2/src/features/tutorial-conversation/model/progress.ts`
  (result union)
- Modify: `client-v2/src/features/tutorial-conversation/model/runners/real-deploy.ts`
  (wire `airdrop` and `isFunded`)
- Modify: `client-v2/src/features/tutorial-conversation/model/ports.ts`
  (`Runner.isFunded?`)

**Interfaces:**
- `deployCost(port: DeployPort): Promise<number>` (in `deploy.ts`): the
  estimate `rent(program.length ?? DEFAULT_LENGTH, onChain) + FEE_HEADROOM`.
- `runAirdropWith(onStage)(port: DeployPort): Promise<RunResult>`.
- `RunResult` gains these two cases:
  - `{ act: "airdrop"; ok: true; seconds; balance: number; airdropped: number }`
  - `{ act: "airdrop"; ok: false; seconds; reason: "no_funds" | "no_wallet" | "failed"; message; balance?; cost?; address? }`,
    where `no_funds` carries `balance`, `cost` and `address` like the deploy's.
- `DeployPort.createWallet(): string`: the real one calls `PgWallet.add()`
  and returns the new address. The airdrop's ok result adds
  `madeWallet?: true`.
- The live card's context for an airdrop act comes from the wallet:
  "{short address} · {balance} SOL", or "A new Playground wallet, made in
  this browser" when there is none. It uses the widget's existing wallet and
  balance source.
- `Runner.isFunded?(): Promise<boolean>`: true only with a wallet whose balance
  covers `deployCost`.

- [ ] Tests in `airdrop.ts`:
  - Funded: no airdrop, and `airdropped: 0`.
  - Short: `fundForDeploy` called with `need = deployCost`, and the terminal
    prints "Airdropping 2 SOL...".
  - Refused: `no_funds` with the balance, cost and address.
  - No wallet: `port.createWallet()` is called once, then the airdrop runs,
    and the result has `madeWallet: true`.
- [ ] Rewrite the funding tests in `deploy.ts`:
  - A short wallet returns `no_funds` and never calls `funding.airdrop`.
  - There is no "Funding your wallet" stage.
  - A binary that outgrew the estimate is checked against the real need and
    still never airdrops.
- [ ] Implement:
  - Drop `DEPLOY_STAGES.funding` and the `fund` closure.
  - The check returns the same `no_funds` shape.
  - `runAirdropWith` reuses `fundForDeploy`.
  - Wire `airdrop: (_, __, onStage) => runAirdropWith(onStage)(realDeployPort())` and
    `isFunded` in `tutorialRunner`.
- [ ] Run `yarn test-unit` on both files and `yarn test-types`. Commit.

### Task 3: The engine and cards

**Files:**
- Modify: `client-v2/src/features/tutorial-conversation/model/store.ts`
  (auto-press)
- Modify: `client-v2/src/features/tutorial-conversation/model/view.ts`
  (retry lines: `ASKS_THE_FAUCET` per act, records)
- Modify: `client-v2/src/widgets/tutorial-conversation/ui/BaseActCard.tsx`,
  `BaseResultCard.tsx` (airdrop record; `no_funds` on airdrop)
- Modify: `client-v2/src/features/tutorial-conversation/model/goals.ts`,
  `reducer.ts`, where an act switch needs the new case.

**Interfaces:** uses `Runner.isFunded` and `PgConversation.act(beatId)`.

- [ ] Store tests (fake runner):
  - The lesson reaching a live airdrop card with `funded → true` dispatches
    one act. The record reads "Your wallet has 3.2 SOL".
  - With `funded → false` there is no act.
  - A probe that throws posts nothing, and the failure is logged and
    reported.
  - A reload with the airdrop already landed does not probe.
  - A press during the probe starts one run.
- [ ] View tests:
  - An airdrop `no_funds` posts the red card, followed by a live card
    "Asks the faucet again" with "Try again".
  - A deploy `no_funds` is followed by "Checks your balance again, then
    deploys".
  - An ok airdrop posts no result card. Its record reads "Added 2 SOL", or
    "Your wallet has 3.2 SOL" when `airdropped` is 0.
- [ ] Telemetry test: `tutorial_action_run` with `action: "airdrop"`, through
      the memory provider.
- [ ] Implement, run the tests, and run `yarn test-types`. Commit.

### Task 4: Lessons, rule, copy, e2e

**Files:**
- Modify: `client-v2/src/tutorials/hello-anchor/tutorial.json`:
  - Add an `s2.airdrop` act before `s2.deploy`: title "Get devnet SOL",
    context "From the devnet faucet · free test SOL", button "Request
    airdrop", say "Get some free devnet SOL for the deploy."
  - Update `s2.why` and the devnet SOL answer at :393.
- Modify: `client-v2/src/tutorials/zero-copy/tutorial.json`: add
  `s2.airdrop` before `s2.deploy`, and update the answer at :479.
- Modify: `client-v2/src/widgets/tutorial-conversation/ui/BaseIntroCard.tsx:15`.
- Modify: `client-v2/src/tutorials/AUTHORING.md`: the rule that an airdrop
  act comes before the first deploy act.
- Modify: `client-v2/e2e/tutorial-hello-anchor.e2e.spec.ts` (`passStepTwo`
  presses "Request airdrop" first), plus any e2e spec that walks a deploy
  card.
- Modify: `openspec/changes/tutorial-flow-v2/specs/tutorial-runs/spec.md`,
  the "Too little balance" and "Airdrop refused" paragraphs, to point at
  this change.

- [ ] Run `yarn tutorial:check` (passes) and `yarn run check`.
- [ ] Run the e2e specs this PR changes (`yarn test-e2e:with-stubs
      e2e/tutorial-hello-anchor.e2e.spec.ts`), within the load gate.
- [ ] Take screenshots at desktop and 390: short, funded, faucet refusal, and
      short at deploy.
- [ ] Commit.
