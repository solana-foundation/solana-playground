# Questions for Almaz: tutorial flow v2

These come from checking `SPEC.md` against the prototype's code (branch
`almaz/mobile-tutorial-prototype`, `fb4b8e9ee`) and the deck. Where the two
differ, the specs follow the prototype. Each question asks whether that is what
you intend; a "no" changes the spec.

**Answered 28 Oct.** Almaz answered all 34 at the design sync
([answers](https://claude.ai/artifact/BryNJQpwujN3HYocHRz92y)). Most confirm
what the specs already held. These changed the specs: 3.9 (a typed "I'm
stuck"), 3.15 (the finish), 3.17 (four assistant tools, no scripted matches),
3.21 (the Call panel's one form and chips), 3.24 (docs as tabs, HOO-2381),
3.25 (the wallet copy), 3.26 (funding and the faucet card), 3.28 (no 7-day
note) and 3.29 (Explorer links). 3.34: both scripts by Fri 30 Oct. All 34 are
closed; his page numbers them 3.1 to 3.34, and `design.md` cites them as Qn.
What is open now comes from Nikita's Spec 00 (`design.md`, Open Questions).

## Start and layout

1. The intro card has "What you'll build", "How it goes" and one button, "Start
   step 1". `SPEC.md` 6.5.1 has a step list, a ↵ key cap and "Ask me anything
   first". We follow the prototype. Is the step list dropped for good?
2. After Start the intro leaves the feed completely. `SPEC.md` keeps it as a
   one-line record. Which do you intend?
3. In a narrow chat column the step bar becomes a dropdown, "Step 2 of 4 ·
   Deploy", rather than unlabelled segments with tooltips. Is the dropdown
   the one to build?
4. A step bar segment lights when its step is entered, not when it passes.
   Intended?
5. "Back to step n" reads "Back to the start" before Start and is hidden after
   the finish. Intended?

## Questions and cards

6. The live question card shows no "Question" tag and no "1 of 4". The record
   shows "Q1" and "Fix". Should the live card show its place?
7. A wrong pick is red, with "Not quite." in front of the reason. Almaz's `SPEC.md`, D13
   says amber with no prefix. We follow red with "Not quite." Confirm?
8. After two wrong picks, the last row is outlined, with no "That leaves one.
   Pick it and I'll write the code." Should the line be dropped?
9. The card has a "Hint" button and the H key. "I'm stuck" exists only through
   it, and the chips row is gone during the lesson. Is that the final shape: no
   chips until the finish?
10. Typing only the key line makes the assistant fill in the rest of the block
    ("on purpose", says the README). Should this be the rule in every tutorial?
11. A question's record expands to all three rows with their reasons. Keep it?
12. The wrote card shows no "+N" count. The editor has no "Assistant wrote
    lines…" chip, and tabs show no `+N`. Are all three dropped?
13. Written lines rest with a grey border and flash green on arrival. The
    landing line is dashed grey. `SPEC.md` says resting green and landing
    purple. Is grey final?
14. The win card has no stat pills, and the data has them unused. Dropped?
15. The finish card has "Transaction details" (collapsed), "Next: <tutorial>"
    and "All tutorials". There is no "Copy receipt" and no "See summary". The
    separate Finish screen has "Back to the tutorial". Which buttons should the
    finish have?

## Composer and the assistant

16. An action word typed while a question is open gets "Pick an answer above
    first, or press Skip." instead of running. Intended?
17. In the product, free questions go to the real assistant. Which of the
    canned intents should stay scripted: "where is the menu" with "Show me",
    "create a project", "do it for me"? Or can the assistant answer them?
18. After the named call in step 4, the assistant rewrites `client.ts` to pass
    the name. Keep this?
19. "Change what hello says": in the product the assistant proposes the line
    as an "Apply to lib.rs" card and never applies it itself. Does that match
    what you want?

## Workspace

20. The head has a "Call" button after deploy, not a "Test" tab. The tools are
    icons without labels. We follow "Call" everywhere: the panel, the win
    card's "Open Call", the record "called from the Call panel". Confirm the
    name?
21. The Call panel is one form for `hello` with a Form | IDL switch. It has no
    program id at the top and no Fill, and shows one result. For tutorials with
    several instructions we plan one card per instruction. We also plan the
    program id with an Explorer link at the top (Jonas asked for Explorer
    links). OK?
    _Superseded by the answer: one form with instruction chips (`design.md`
    D11)._
22. A call from the panel posts nothing in the chat; only the step's win
    follows. Intended?
23. The file tree shows folders (`src`, `client`), not the explorer's
    sections (Program, Client, Tests). `tests/anchor.test.ts` is not there.
    Folders final?
24. On the call you showed docs opening as browser-style tabs. The prototype
    opens only files as tabs. Should documentation pages open as tabs beside
    the files? If yes, which docs, and from where?

## Deploy and real costs

25. In the product, deploys go from the learner's Playground wallet on devnet
    (airdrop top-up), not through Kora, for Breakpoint. Every "0 SOL", "paid by
    Kora", "No wallet" and "What is Kora?" needs new words. Can you give the
    copy for the intro note, the deploy card's context line, the deploy and
    call results, the win pills and the finish line?
26. With a real wallet the first deploy can wait for an airdrop or fail on the
    devnet faucet's limit. How should "Funding your wallet" and "Not enough
    devnet SOL" (with a faucet link and the address to copy) look?
27. The deploy shows four stages: Writing buffer, Deploying, Uploading IDL,
    Confirming. `SPEC.md` has three. We follow four. Confirm?
28. "Programs nobody calls for 7 days are closed" is Kora's rule. Without Kora
    it does not hold. Drop the note?
29. Every result links its program id and transaction to Solana Explorer on
    devnet. Where on the cards should the links sit?

## Phone

30. The phone has two spaces, Chat and Code, with a swipe, and a status strip
    at Code's foot. `SPEC.md` has three tabs, Chat, Code and Output. We follow
    two spaces. Confirm?
31. The header has no close button. The steps sheet holds "Start over…".
    Intended?
32. The phone has no "Type it myself" and no "I'll fix it myself", and its win
    card has no "Open Call". The deck says typing Rust is left to the desktop.
    Confirm?

## Tutorials page

33. The started card shows "<passed> of 4" beside the name, and a finished one
    a check. The Start here banner has three states: start, continue with
    "Next: <objective>", and finished with "Start <next>" and "Open again". We
    take all of it as drawn. Anything to change?
34. Lumberjack and Zero Copy: when will their scripts be ready in the same
    shape as Hello Anchor's (steps, questions with three options and reasons,
    hints, wins)?
