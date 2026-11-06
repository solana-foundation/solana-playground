# Tasks

Spec ticket: HOO-2321. One task is one ticket and one PR. Owner and estimate
(session-days) follow each task. Each task's "after" list is what it waits
for; tasks with "after nothing" start at once.

## 1. Definition

- [x] 1.1 Definition v1: `tutorial.schema.json`, `yarn tutorial:check` with
      the semantic rules, the loader into the catalog (with "<passed> of <m>"
      progress and the "<level> · <framework>" meta line), Hello Anchor's prototype script as `tutorial.json`,
      `tutorial_definition_rejected`. Verify: the check passes on Hello Anchor
      and fails with path errors on the spec's two broken fixtures; the catalog
      lists Hello Anchor from JSON (HOO-1792; fleet; M 1.5; after nothing;
      plan: [plans/1.1-definition-v1.md](plans/1.1-definition-v1.md))
- [x] 1.2 `AUTHORING.md`, the instruction an agent follows to write a
      tutorial. Verify: an agent following only it writes a two-step fixture
      tutorial that passes the check and runs (HOO-2347; Natalia; S 1;
      after 1.1; plan:
      [plans/1.2-authoring-instruction.md](plans/1.2-authoring-instruction.md))
- [x] 1.3 The outside author kit: the recipe tried on two models (Claude Sonnet, Claude Haiku) that see only
      `AUTHORING.md` and the schema, what blocked them fixed there, and a
      how-to for an author outside the team; the non-Claude run is Cat McGee's.
      Verify: both drafts pass the check (HOO-2647; fleet; S 0.5; after 1.2; plan:
      [plans/1.3-outside-author-kit.md](plans/1.3-outside-author-kit.md))

## 2. Frame

- [x] 2.1 The tutorial frame: rail, chat column and workspace slot, the
      navigation folding to its rail with overlay, pin and the first-time hint,
      the chat head with back, name and ⋯ menu, column width and handle,
      opened for a tutorial with a definition. Verify: unit tests for the fold
      rules and the width clamp; widths at 1440, 1280 and 1152 (HOO-2348;
      fleet; M 1.5; after nothing;
      plan: [plans/2.1-tutorial-frame.md](plans/2.1-tutorial-frame.md))
- [x] 2.2 The workspace: head tabs that never close, the Call button slot,
      Files ⌘E and Terminal ⌘J icons, the tree popover and dock, the terminal
      bar and drawer with its states and auto-open rules, the editor's
      written, arriving, landing, error and busy lines. Verify: unit tests
      for the line states and the tree keys (HOO-2349; fleet; M 1.5;
      after nothing; mounts in 2.1's slot;
      plan: [plans/2.2-tutorial-workspace.md](plans/2.2-tutorial-workspace.md))
- [x] 2.3 Docs as read-only tabs: the definition's docs list and its
      Markdown, the tree's `Docs` folder, the closable doc tab with its link
      to the source page, assistant links that open it, Hello Anchor's four
      pages. Verify: the spec's "A doc from the assistant's answer"; the
      check fails on a missing doc file (HOO-2381; Natalia; M 1.5; after
      1.1, 2.2; the phone's Code list moved to HOO-2359, which builds the
      phone layout;
      plan: [plans/2.3-docs-tabs.md](plans/2.3-docs-tabs.md))

## 3. Conversation

- [x] 3.1 The conversation engine: the reducer over definition and
      progress, the runner's clock, saving to `tutorial-storage.json` under
      `conversation`, reload (turns whole, runs interrupted), Start over,
      `tutorial_started` and `tutorial_finished`. Verify: unit tests that walk
      Hello Anchor's definition from intro to finish with stubbed runs, and
      reload at every beat (HOO-2350; fleet; M 1.5; after 1.1;
      plan: [plans/3.1-conversation-engine.md](plans/3.1-conversation-engine.md))
- [x] 3.2 Step goals on real results: `build`, `deploy` and `call` checks
      in the feature slice, reusing `VerifyCondition`'s logic from
      `verify.ts` rather than extending the lessons type, `read` dropped,
      `tutorial_step_passed`.
      Verify: unit tests per goal, including a call before the upgrade that
      does not pass the argument goal (HOO-1790; fleet; S 1; after 1.1;
      plan: [plans/3.2-step-goals.md](plans/3.2-step-goals.md))
- [x] 3.3 The feed: intro card, dividers, step bar with its states and keys,
      say and quote, wrote card, the act card (stages, "n of m", the stage
      bar, disabling, call-act fields) and the result card shell, records,
      the back pill, `role="log"`, the read-only preview, the wrote card's
      appended note with its confirmed Reset (the step restarted),
      `tutorial_opened`, `tutorial_step_reset`,
      `tutorial_step_jumped` and `tutorial_step_back`.
      Verify: component tests for every record line in the spec and the jump
      from step 3 to step 1 (HOO-2351; fleet; M 1.5; after 2.1, 3.1;
      plan: [plans/3.3-feed.md](plans/3.3-feed.md))
- [x] 3.4 Win and finish cards: Next with ↵, "Open Call" / "Write it in
      client.ts", the finish's Transaction details with the Copy receipt
      icon, "What you learned", the "steps · time · devnet only" line,
      "Next: <tutorial>" and "All tutorials", no stat pills,
      `tutorial_next_opened` and `tutorial_receipt_copied`. Verify: component tests for the last step's win with no Next
      (HOO-2352; fleet; S 1; after 3.1;
      plan: [plans/3.4-win-finish.md](plans/3.4-win-finish.md))
- [x] 3.5 The question card: picks, keys (1-3, H, S), "Not quite." and
      reasons, two-wrong outline, Hint (no model needed), Skip, Type it
      myself, the key line typed by hand, the right pick's write with its
      wrote card, the written, arriving and landing lines passed to the
      workspace (`TutorialWorkspace`'s `marks`, from the engine's `Wrote` and
      `landingFor`; 3.3 landed without them), the expandable
      record, `tutorial_question_answered`.
      Verify: component tests for the spec's wrong-then-right scenario and
      the typed-by-hand path (HOO-2353; fleet; M 1.5; after 2.2, 3.1;
      plan: [plans/3.5-question-card.md](plans/3.5-question-card.md))
- [x] 3.6 Composer and the live assistant in one thread: action words (and
      the open-question refusal), the finish chips, free messages to the
      assistant in tutorial mode with its four interface tools (open the
      menu, Hint, Skip, the apply card) and no writing or running tools, the
      doc list in its context, the merged feed, `tutorial_question_asked`.
      Verify: unit tests for the routing order; typed "I'm stuck" posts the
      hint; a tool call to write a file is refused in tutorial mode (HOO-2354; fleet; L 2.5; after 3.1;
      plan: [plans/3.6-composer-and-assistant.md](plans/3.6-composer-and-assistant.md))
- [x] 3.6a Composer: review leftovers from #271: the failed build's two buttons
      and the folded composer at the prototype's sizes, one button height on
      the intro, act, result and finish cards, and the question event on the
      step it was asked on (HOO-2626; fleet; S 0.5; after 3.6;
      plan: [plans/3.6a-composer-leftovers.md](plans/3.6a-composer-leftovers.md))
- [x] 3.6b Composer before Start, bug-fix sized: an answer before Start ends by
      inviting the learner to begin, a menu-only turn included; the requirement
      "One composer" naming the start words and the invitation is part of the
      deliverable, per the ticket (HOO-2571; fleet; S 0.5; after 3.6;
      plan: [plans/3.6b-composer-before-start.md](plans/3.6b-composer-before-start.md))

## 4. Runs

- [x] 4.1 Build act and the planned failure: build through the server, the
      error parsed to code, line and column, the failed card with Explain and
      "I'll fix it myself", the planned explanation and fix question, the
      unplanned failure through the assistant with "Show me the fix",
      `tutorial_action_run` for builds (fired from the reducer for every act by
      4.2, PR 241, agreed 3 Nov). Verify: parser unit tests on real
      server logs; Hello Anchor's E0412 path in a component test (HOO-2355; fleet; M 1.5; after 3.1, 3.2;
      plan: [plans/4.1-build-act.md](plans/4.1-build-act.md))
- [ ] 4.2 Deploy from the wallet: no-wallet path, "Funding your wallet" as
      an extra first stage, the red "Not enough devnet SOL" card with its
      address row and Open faucet, Try again as the act card under it, the program keypair kept,
      upgrade in place, the result with devnet SOL spent and the program id
      and signature as Explorer and Transaction links in its details, the wallet copy, the redeploy nudge (split into its own PR, 3 Nov),
      a deploy recognised after a reload, `tutorial_action_run` for deploys.
      Verify: unit tests with a stubbed connection for funding and
      recognition, and `outcome: "no_funds"` on a refused airdrop; one devnet deploy and upgrade
      by hand (HOO-2356; fleet; L 2.5; after 3.1, 3.2;
      [plan](plans/4.2-deploy-from-wallet.md))
- [ ] 4.3 Client run and the call act: the run bound to the program and
      wallet, the signatures it sent captured, logs fetched and the
      definition's line picked, Copy signature and Explorer in the result
      card's details (the receipt rows are 3.4's), failed
      transactions, `tutorial_action_run` for runs and calls. Verify: unit tests for signature capture and log picking;
      Hello Anchor's step 3 on devnet by hand (HOO-2357; fleet; M 1.5;
      after 3.1, 3.2; plan:
      [plans/4.3-client-run-and-call.md](plans/4.3-client-run-and-call.md))
- [x] 4.4 The Call panel from the deployed IDL: the Form | IDL switch, the
      program row with Explorer, one form with the instruction chips (the
      step's own picked, none for one instruction), "New" fields, one call
      button, the result naming its instruction, the latest result in the panel and the log in the terminal,
      passing steps 3 and 4, `tutorial_action_run` with `call_panel`, and
      the opener the win card's "Open Call" waits for (3.4's
      `TODO(tutorial-flow-v2 4.4)`).
      Verify: component tests for the upgrade adding
      `name`; a call passing step 3 (HOO-2358; fleet; M
      1.5; after 2.2, 4.3; plan: [plans/4.4-call-panel.md](plans/4.4-call-panel.md))

## 5. Phone

- [x] 5.1 The phone: the header with the steps sheet and Start over, the
      Chat | Code spaces with swipe and Code's dot, Code's file list (docs
      included) and status strip, the chat's finish card with the header's
      "Done · n of n", Show in switching to Code, the Call sheet, no typing
      paths, touch sizes. Verify: component tests at 390 px;
      the same turns as desktop from one saved progress (HOO-2359;
      fleet; L 2.5; after 3.3, 3.5, 4.4; plan: [plans/5.1-phone.md](plans/5.1-phone.md))

## 6. Tutorials page and content

- [x] 6.1 The tutorials page by level: tutorials-gallery-stand tasks 3.1 and
      3.2, plus a conversation tutorial's "<passed> of <m>" on its card and
      "Continue · Step n of m" on the Start here banner. Verify: that change's
      scenarios, except its caption and "Page n of m" banner, which
      `tutorial-definition` overrides for conversation tutorials, and "Hello
      Anchor half done" (HOO-2360; Natalia; S 1;
      after 1.1)
- [ ] 6.2 Hello Anchor on the real flow: the wallet copy of `tutorial-runs`,
      the log patterns and goals tuned on the build server and devnet, a full
      run by hand. Verify: the check passes and a full run lands every win
      (HOO-2361; Natalia; S 1; after 1.2, 4.1, 4.2, 4.3). The copy has landed;
      the full run by hand and any tuning it calls for happen on
      `scope/tutorial-flow`, which ticks this line (Slava, 6 Nov). Plan:
      [plans/6.2-hello-anchor.md](plans/6.2-hello-anchor.md)
- [ ] 6.3 Lumberjack (Intermediate) as a definition from Almaz's script.
      Verify: the check passes; a full run on devnet (HOO-2362; Natalia;
      M 1.5; after 1.2 and Almaz's script, due Fri 30 Oct)
- [ ] 6.4 Zero Copy (Advanced) as a definition from Almaz's script, with the
      deploy and rent costs confirmed on devnet. Verify: the check passes; a
      full run on devnet (HOO-2363; Natalia; L 2.5; after 1.2 and
      Almaz's script, due Fri 30 Oct)
      Plan: [plans/6.4-zero-copy.md](plans/6.4-zero-copy.md)
- [ ] 6.5 e2e for the flow: Hello Anchor from intro to finish on desktop
      and at 390 px, in CI on a fake build server and devnet, with the real
      ones as the manual case T-1 in `docs/testing.md`; the wrong pick,
      planned failure, faucet limit and Call panel paths (the Call panel spec
      is a fixme until HOO-2358 lands). Verify: the specs run green
      in CI's e2e job (HOO-2364 desktop, fleet; HOO-2510 phone; M 1.5; after 3.5, 4.1, 4.2,
      4.4, 5.1, 6.2; plan: [plans/6.5-e2e-desktop.md](plans/6.5-e2e-desktop.md))

## 7. Cleanup

- [x] 7.1 Retire the lesson band, rail, reader and phone bar, `PgLesson`'s
      key and `migrate.ts`, and the assistant's lesson suggestions
      (`SUGGESTIONS.lesson`), its "Step n of m" chip and `lesson-context.ts`,
      per the `client-v2-lessons` delta. Verify also the delta's "Suggestions
      outside a tutorial". Verify: `yarn run check` passes and no import of `views/flow/lessons` remains
      (HOO-2365; fleet; XS 0.5; after 3.3, 6.2). Plan:
      [7.1-retire-lesson-layer](plans/7.1-retire-lesson-layer.md)
- [x] 7.2 No act record right above its own result card: the act gives way to
      the card, whose details hold the time, and a run the goal refused comes
      back as a live act card with its own button (HOO-2543; fleet; XS 0.5; after 3.3, 4.1).
      Plan: [7.2-record-under-result](plans/7.2-record-under-result.md)
