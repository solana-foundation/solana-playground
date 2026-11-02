# Proposal

## Why

On the 27 Oct call Cat approved Almaz's tutorial flow v2. In it the lesson is
one conversation with the assistant: it explains a piece, asks a question with
three answers, and writes the code once the learner picks the right one. Build,
deploy, run and call sit on the latest card in the chat. One tutorial per level
ships on this flow for Breakpoint (11 Nov), and the original scope stays.
Today's lesson is a band, a step rail and a reader over upstream's Markdown
pages. Only Hello Anchor has steps, and the assistant is a separate panel that
only reads the lesson. Nothing in that shape carries the new flow, so this
change describes it as a contract the build sessions can split.

The design source is Almaz's `SPEC.md` and his prototype (branch
`almaz/mobile-tutorial-prototype`, `design-system/src/prototype/tutorial-v2`,
commit `fb4b8e9ee`). The prototype mocks the model, the build server and
devnet. This change keeps the lesson content scripted, as the prototype has it,
and makes everything else real. The tutorial content is written in a JSON
definition. Free questions go to the product's assistant. Build, deploy and
calls run against Playground's build server and devnet from the learner's
wallet. A step passes on what actually happened.

## What Changes

- **Tutorial definition in JSON.** A tutorial on the new flow is a JSON file:
  steps, beats (say, write, ask, act), questions with three options and the
  reasons the wrong ones are wrong, hints, finish chips with their answers, win
  copy, the tutorial's doc pages as Markdown, and the files at each step's start and target. A schema validates it
  and names every error by its path. A loader turns it into a tutorial the
  catalog lists. An authoring instruction, self-contained so any LLM can use
  it, lets an agent write a new tutorial from a conversation with a product
  person. A tutorial is published by a pull request; there is no admin panel.
- **The lesson is the conversation.** A tutorial opens as one chat column
  beside the workspace, with no Lesson or Assistant tabs:
  - an intro card replaces the About page as the start;
  - each step opens with a divider in the feed;
  - a step bar, one segment per step, jumps back to the dividers;
  - the question, wrote, act, result, win and finish cards are the only places
    an action lives;
  - one composer: an action word runs the live action, a finish chip gets
    its answer, anything else goes to the live assistant, which in a
    tutorial never writes or runs anything itself. It acts on the interface
    only through four tools: open the menu, the hint, Skip, and a proposed
    change to apply.
- **The workspace beside it:**
  - before Start, the finished program, read only;
  - the editor shows the lines the assistant wrote;
  - the file tree opens from a toggle on the active tab and docks with a pin;
  - the tutorial's doc pages open as read-only tabs that close, from a
    `Docs` folder in the tree or a link in the assistant's answer;
  - the terminal bar is always on screen;
  - the first deploy adds a Call panel built from the deployed IDL;
  - the navigation folds to its icon rail on entering a tutorial.
- **Real runs inside the flow.**
  - Build uses Playground's build server. Deploy and upgrade go from the
    learner's Playground wallet, funded on devnet the way deploy funds it today.
  - Running the client and calling from the Call panel go to devnet.
  - Every deploy and call result links its program id and transaction to
    Solana Explorer on the devnet cluster (Jonas), as the keys themselves.
  - Every Kora line is replaced by Almaz's wallet copy, and a refused
    airdrop gets a "Not enough devnet SOL" card with the faucet.
  - Kora's 0 SOL deploy is not in this change.
- **Step checks on what happened.** Each step's goal in the definition is
  checked against the real result: a build passes, a deploy lands, an
  instruction is called with an argument and its log line comes back. The
  assistant judging a step is not in this change.
- **The phone shows the same conversation.** It has the same cards and
  questions, with Chat and Code as two spaces and the Call panel in a sheet.
  Typing code is left to the desktop.
- **The three Breakpoint tutorials as definitions:** Hello Anchor (Beginner,
  the prototype's script), Lumberjack (Intermediate) and Zero Copy (Advanced).
- **BREAKING for the lesson layer:**
  - the objective band, the step rail and the phone's lesson bar of
    `client-v2-lessons` go away;
  - Hello Anchor was the only tutorial with a lesson path, and it moves to the
    conversation;
  - tutorials without a definition keep upstream's pages, unchanged.
- **Telemetry:** the tutorial slice adds the events in the `tutorial-conversation`
  and `tutorial-runs` specs (open, start, question answered, question asked,
  action run, step passed, step reset, step jumped, step back, finish, definition
  rejected). It renames or removes none.

## Capabilities

### New Capabilities

- `tutorial-definition`: the JSON format of a conversation tutorial, its
  schema and validation errors, the loader that lists it in the catalog, and
  the authoring instruction an agent follows to write one.
- `tutorial-conversation`: the lesson as one chat column: intro, step
  dividers, the step bar, the cards and their records, chips, the composer,
  free questions to the live assistant, keyboard paths, saved progress and
  reload.
- `tutorial-workspace`: the frame around the conversation: the folded
  navigation, the chat column width, the editor's written and landing lines,
  the file tree popover, doc tabs, the terminal bar and drawer, and the Call
  panel built from the deployed IDL.
- `tutorial-runs`: build, deploy, upgrade, client run and calls inside a
  tutorial against the build server and devnet, wallet funding, Explorer
  links, interrupted runs, and what passes each step.
- `tutorial-phone`: the same conversation on a phone, with Chat and Code as
  two spaces and the Call panel in a sheet.

### Modified Capabilities

- `client-v2-lessons`: the objective band, the step rail, the reader and the
  phone's lesson bar are removed, and the assistant panel loses its lesson
  suggestions and "Step n of m" chip. The lesson that used them now runs in the
  conversation.

## Impact

- **Code:**
  - `client-v2/src/tutorials/` gains the definition loader and the three
    definitions.
  - The conversation, workspace and phone screens arrive as new slices beside
    `client-v2/src/views/flow/lessons/`, which they replace for tutorials with a
    definition.
  - The assistant widget (`client-v2/src/widgets/assistant/`) gets a tutorial
    mode whose thread is the lesson's chat.
  - Builds and deploys reuse `client-v2/src/commands/build` and
    `client-v2/src/commands/deploy` (BPF upgradeable loader, airdrop top-up).
  - The Test form reuses `client-v2/src/views/sidebar/test/`.
- **Storage:**
  - Lesson progress stays in the workspace's `.workspace/tutorial-storage.json`,
    so project sync carries it between devices.
  - Free questions and their answers live in the assistant's thread for the
    workspace, as every chat does.
- **User-visible consequence of the infrastructure items:**
  - the build server makes the first green build real and needs it reachable
    (it is, from Vercel and localhost);
  - deploying from the wallet means a learner with an empty devnet wallet waits
    for an airdrop or is asked to fund the wallet, so a deploy is not instant
    the way the prototype shows it;
  - the Explorer links make every deploy and call checkable outside Playground.
- **Out of scope:**
  - Kora's 0 SOL deploy (HOO-1778, HOO-1780);
  - the assistant judging a step (not ticketed; a later change);
  - a DSL for tutorials; an admin panel is not planned at all;
  - migrating the other 13 tutorials;
  - the live wall of hellos and the share link;
  - mainnet;
  - light theme;
  - any change to `server/` or `client/`.
