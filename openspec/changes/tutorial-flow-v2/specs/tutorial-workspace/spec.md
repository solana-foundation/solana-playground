# Spec Delta

## Purpose

The frame a conversation tutorial runs in: the navigation folded to its rail,
the chat column and the workspace beside it, the editor's written and landing
lines, the file tree, the terminal, and the Call panel built from the deployed
IDL. Visual values follow Almaz's `SPEC.md` sections 4, 5 and 8.

## ADDED Requirements

### Requirement: Rail, chat, workspace, in that order

On a desktop from 1152 px wide, a conversation tutorial SHALL lay out the
navigation rail, the chat column and the workspace, left to right, with no
horizontal scroll. Their heads SHALL share one 44 px line. The chat head holds
a back button "Tutorials", the tutorial's name and a ⋯ menu with "Start
over…" and "Keyboard shortcuts". The chat column SHALL default, for a
window W px wide, to `400 − (1280 − W) × 0.3125` under 1280 and
`400 + (W − 1280) × 0.134` from 1280, rounded and held to 360–480 px (360 at
1152, 400 at 1280, 421 at 1440). It SHALL be resizable from 340 to 560 px by a
handle on its right edge, never leaving the workspace under 560 px; the
focused handle takes the arrow keys (16 px, 64 with Shift), Home and End, and
a double click resets it. A picked width SHALL be kept on the device until
it is reset. The column order SHALL not be swappable.

#### Scenario: Widths at 1440 (manual)

- **WHEN** a tutorial is open in a 1440 × 900 window
- **THEN** the rail is 52 px, the chat column 421 px and the workspace fills
  the rest
- **AND** the page has no horizontal scroll

### Requirement: The navigation folds to its rail in a tutorial

Entering a tutorial (Start, Continue or a card) SHALL fold the navigation to
its icon rail, whatever was saved. In a tutorial:

- **Open:** the mark's button or ⌘B SHALL open the navigation as an overlay
  over the chat with a scrim. The chat SHALL stay where it was: the overlay
  takes only the rail's width in the row.
- **Close:** a pick, a scrim click, Esc or ⌘B SHALL close the overlay and
  return focus.
- **Pin:** a pin in the overlay's head SHALL dock it open until the learner
  leaves the tutorial. Its tooltip reads "Keep open"; once pinned, "Fold
  while I learn".
- **Leaving:** the navigation SHALL return to its usual behaviour.

On the first fold only, a one-line hint "The menu is folded to icons while you
learn" SHALL show beside the mark for 6 s, or until a pointer down or a key.

#### Scenario: Opening the menu in a tutorial

- **WHEN** the learner presses ⌘B on step 2
- **THEN** the navigation covers the chat with a scrim and the live card keeps
  its state
- **AND** Esc closes it and focus returns where it was

### Requirement: The frame is measured

The tutorial frame slice SHALL emit, under the prefix `tutorial_frame`:

- `tutorial_frame_menu_opened` when the navigation opens as an overlay, with
  `via`: `key` (⌘B) or `button`;
- `tutorial_frame_menu_pinned` when the pin docks the navigation or folds it
  back, with `pinned`;
- `tutorial_frame_chat_resized` when the learner sets the chat's width, with
  `width` in px and `via`: `drag`, `key` or `reset`.

#### Scenario: Pinning the menu

- **WHEN** the learner opens the navigation with its button and pins it
- **THEN** `tutorial_frame_menu_opened` reaches the memory provider with
  `via: "button"`, then `tutorial_frame_menu_pinned` with `pinned: true`

### Requirement: The workspace head holds tabs, Files and Terminal only

The workspace head SHALL hold:

- the file tabs, which never close, and the doc tabs, which close;
- once the program is deployed, a "Call" button that opens the Call panel,
  set apart by a rule;
- the icon buttons Files (⌘E) and Terminal (⌘J), with tooltips, both
  `aria-pressed` while their panel is open.

It SHALL hold no Build, Deploy or Run. The active file tab SHALL carry a tree
toggle, a chevron button with `aria-label="Files"` and `aria-expanded`. The
Call button SHALL carry a dot on its first appearance, and again once when the
IDL changes.

#### Scenario: The head after step 3 (manual)

- **WHEN** step 3 has started
- **THEN** the head shows the tabs `lib.rs` and `client.ts`, then Call, Files
  and Terminal
- **AND** no file tab has a close button

### Requirement: Docs open as read-only tabs

Each tutorial SHALL have its own short list of doc pages, only the ones that
tutorial needs, kept as Markdown with the tutorial (see `tutorial-definition`).
They SHALL open as tabs beside the file tabs:

- **From the tree:** the list shows as a `Docs` folder under `src` and
  `client`; picking a page opens it as a tab.
- **From the assistant:** where a page helps (an explanation, Explain on a
  build error), the assistant links it in its message, and the link opens it
  as a tab. A page SHALL never open by itself; the code keeps the focus.
- **The tab:** the page rendered read only, with its title and a link to the
  page on its own site, opening in a new tab. A doc tab SHALL close; file
  tabs SHALL not.

Pages SHALL be served from the tutorial's own Markdown, never framed from the
docs site. Open doc tabs SHALL be saved with the workspace state.

#### Scenario: A doc from the assistant's answer

- **WHEN** on Hello Anchor's step 2 the assistant's answer links "IDL"
- **THEN** pressing the link opens an "IDL" tab beside `lib.rs`, read only,
  with a link to the page on Anchor's site
- **AND** the tab's close button closes it, and `lib.rs` keeps its tab

### Requirement: The editor shows written, landing, error and busy lines

The editor SHALL mark lines by state:

- **Written:** the lines the assistant wrote this beat: a quiet grey left
  border, until the next action or an edit of those lines.
- **Arriving:** the same lines flash green on arrival, settling over 1.4 s,
  40 ms apart.
- **Landing:** where an open question's block will go: a dashed grey left
  border. On an empty line it shows the ghost text "Your answer lands here",
  `aria-hidden` and not part of the file.
- **Error:** a red line with a wavy underline under the failing token.
- **Busy:** dimmed and read only while an act runs.

Every file SHALL stay editable, except the intro preview and the files the
definition marks read only. Under reduced motion the lines SHALL show at their
resting state with no animation.

#### Scenario: The landing line (manual)

- **WHEN** Hello Anchor's first question is open
- **THEN** `lib.rs` line 5 shows "Your answer lands here" with the landing
  border
- **AND** the ghost text is not in the file's content

### Requirement: The file tree opens from the active tab and can dock

The tree toggle or ⌘E SHALL open a 256 px popover under the active tab,
showing the tutorial's files in their folders (`src`, `client`), then the
`Docs` folder. A tutorial's tree SHALL hold no `tests` folder:

- the open file is marked;
- the live step's file carries a dot;
- a file a later step creates is disabled, with "Created in step n".

In the popover, arrows move, Enter opens the file as a tab and closes the
popover, and Esc closes it and returns focus to the toggle. A pin SHALL dock
the tree as a 220 px column left of the editor. The pin is hidden under
1100 px of workspace, and the docked state is saved with the tutorial.

#### Scenario: From client.ts back to lib.rs (manual)

- **WHEN** on step 3 the learner opens the tree from `client.ts` and picks
  `lib.rs`
- **THEN** `lib.rs` opens and the popover closes
- **AND** the `client.ts` tab is still one click away

### Requirement: The terminal bar is always on screen

A 28 px terminal bar SHALL stay at the workspace's foot with:

- a status dot: idle, busy, ok, failed, or amber for a changed file;
- the last status text: "Ready", "Build successful · IDL: 1 instruction ·
  hello", "Deploying" (with " · <stage>" once the deploy reports its
  stages), or in amber "<file> changed since the last deploy";
- ⌘J.

Before anything has run, the drawer SHALL read "Nothing run yet. Builds,
deploys and calls print here." A click on the bar or ⌘J SHALL open a drawer, 240 px by default, resizable
from 120 px to 60 % of the workspace. The drawer SHALL open by itself on a
failed build and the first deploy, and otherwise stay as the learner left it.
The first client run SHALL open it too, once the run act lands (section 4).

#### Scenario: The first deploy opens the terminal (manual)

- **WHEN** the first deploy of a tutorial lands
- **THEN** the drawer opens with the deploy's log
- **AND** a later deploy does not open it if the learner closed it

### Requirement: The workspace is measured

The tutorial workspace slice SHALL emit, under the prefix
`tutorial_workspace`:

- `tutorial_workspace_tree_opened` when the tree opens as a popover, with
  `via`: `tab` (the active tab's chevron), `button` (Files) or `key` (⌘E);
- `tutorial_workspace_tree_docked` when the pin docks the tree or the unpin
  puts it back, with `docked`;
- `tutorial_workspace_file_opened` when the learner opens a file other than
  the open one, with `via`: `tab` or `tree`;
- `tutorial_workspace_doc_opened` when the learner brings a doc page to the
  front from the tree or from a link in the assistant's answer, with `doc`
  (its Markdown file) and `via`: `tree` or `assistant`;
- `tutorial_workspace_terminal_opened` when the drawer opens by itself, with
  `reason`: `build_failed` or `first_deploy`.

#### Scenario: Opening the tree with ⌘E

- **WHEN** the learner presses ⌘E in a tutorial
- **THEN** the tree opens under the active tab
- **AND** `tutorial_workspace_tree_opened` reaches the memory provider with
  `via: "key"`

### Requirement: The Call panel is built from the deployed IDL

The Call button SHALL open the Call panel over the editor area. The panel
holds a Form | IDL switch:

- **Form:** one form, so one call at a time:
  - at the top, the program's name and id, with Copy and an Explorer link;
  - an instruction picker, a row of chips with the instruction names. The
    live step's own instruction is picked when the panel opens. A program
    with one instruction shows no picker;
  - the picked instruction's typed fields for its arguments;
  - one primary button "Call <instruction>". Enter in a field calls.
- **IDL:** the deployed IDL's JSON, read only, with a copy button.

The panel SHALL read the IDL of the last deployed build, never the live file.
An argument added by an upgrade SHALL carry a "New" tag on its first view. A
call SHALL be disabled while a required field is empty and while a call runs.
A string field stops at 32 characters.

One result, the latest, SHALL show under the form as the conversation's
result card. It names the instruction it called and keeps its Explorer link
on its result line. The log SHALL go to the terminal. A result SHALL not post its own
card in the feed: the step's win follows when the call passes a goal. A result
SHALL hide once the IDL's shape changes. Before any deploy there SHALL be no
Call button.

#### Scenario: The upgrade adds a field (manual)

- **WHEN** step 4's build and deploy lands
- **THEN** the `hello` form shows `name string` with "New", and the Call
  button's dot shows once
- **AND** typing `name: String` in `lib.rs` before that upgrade adds no field

#### Scenario: A deploy outside the cards (manual)

- **WHEN** the learner adds an argument, builds, and runs `deploy` in the
  terminal (or deploys from the explorer's menu or through the assistant), and
  the deploy lands on devnet in the tutorial's own workspace
- **THEN** the Call panel shows the new argument with "New", and no step passes
  on that deploy
- **AND** a deploy that finished on another cluster, or after a switch to
  another workspace, leaves the panel as it was

#### Scenario: Several instructions (manual)

- **WHEN** a program has three instructions and the live step's goal calls
  the second, and the learner opens the Call panel
- **THEN** a chip row lists the three with the second picked
- **AND** the panel holds one form and one "Call <second>" button

### Requirement: Keyboard paths are listed

"Keyboard shortcuts" in the ⋯ menu SHALL list these keys:

- ⌘↵ runs the live action, except from the composer;
- ↵ Start or Next;
- 1 2 3 pick;
- H shows the question's hint;
- S skips the question;
- ⌘B the menu;
- ⌘E the files;
- ⌘J the terminal;
- ⌥↑ ⌥↓ the previous and next step.

None of them SHALL fire while focus is in a text field, except ⌘B, ⌘E and
⌘J. Off a Mac, Ctrl E in the terminal SHALL stay the shell's end of line.

#### Scenario: Typing a digit in the composer (manual)

- **WHEN** a question is open and the learner types "1" in the composer
- **THEN** the composer holds "1" and no option is picked
