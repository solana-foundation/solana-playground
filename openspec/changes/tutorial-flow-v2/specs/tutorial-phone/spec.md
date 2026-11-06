# Spec Delta

## Purpose

A conversation tutorial on a phone: the same thread, cards and questions as
on the desktop, with the code one tap away in a second space and the Call panel
in a sheet. Visual values follow Almaz's `SPEC.md` section 11 and the
prototype's phone screens.

## ADDED Requirements

### Requirement: The phone shows the same conversation

Below the tutorial frame's width (a viewport under 1024 px: a phone, or a
tablet, whose chat is 640 px wide and centred) a conversation tutorial SHALL
render the same turns,
cards, questions and order as on the desktop, from the same saved progress. A
step started on one device SHALL continue on the other. Where the definition
gives a phone variant of a text, the phone SHALL show that variant. The header
SHALL show:

- back, to the tutorials list with progress kept;
- a button with the tutorial's name and where the learner is, which opens a
  sheet of the steps with their titles and objectives and "Start over…";
- the Chat | Code switch;
- the step track along its bottom edge.

Before Start, the "Start step 1" button SHALL take the composer's place, under
the thumb.

#### Scenario: Same path, same questions (manual)

- **WHEN** Hello Anchor runs to step 3 on a 390 px phone and on a 1440 px
  desktop
- **THEN** both feeds hold the same turns in the same order
- **AND** both show the same questions so far, with the same options

### Requirement: Chat and Code are two spaces

The header's switch, or a sideways swipe, SHALL move between two spaces:

- **Chat** (the default): the feed and the composer.
- **Code:**
  - the files, read only, with the written, landing and error line states;
  - a file list with the tutorial's files and its doc pages, which open
    there like a file;
  - "Call" in its head once the program is deployed;
  - a status strip at its foot with the last result.

A dot SHALL mark Code when the assistant wrote since it was last viewed. "Show
in <file>" on a wrote card SHALL switch to Code with the lines lit, and a
result card's Log SHALL switch to Code with the terminal open.

Other differences from the desktop:

- act buttons sit full width under their text;
- option rows are at least 48 px, with no key hints;
- every touch target is at least 44 px;
- the learner only taps the card at the bottom of the chat;
- the "Not enough devnet SOL" card's address row takes the full width;
- the finish is the chat's finish card, as on the desktop, with no screen
  of its own (Almaz's phone prototype, 2 Nov); the header then reads
  "Done · n of n" and Code's dot no longer shows.

#### Scenario: The assistant wrote, seen from Chat (manual)

- **WHEN** a right pick writes lines while Chat is open
- **THEN** the wrote card shows the first lines in the feed and Code gets its
  dot
- **AND** "Show in lib.rs" switches to Code with the lines lit

#### Scenario: A result's Log, seen from Chat (manual)

- **WHEN** the learner presses Log on a deploy's result card while Chat is open
- **THEN** the phone switches to Code and the terminal opens there

### Requirement: The phone leaves typing code to the desktop

On a phone the question card SHALL offer "Hint" and "Skip" without "Type it
myself", and a failed build SHALL offer "Explain the error" without "I'll fix
it myself". A win card SHALL have no "Open Call". The Call panel SHALL open
as a sheet over the code from Code's head, with the same form, results and
step passing as the desktop's panel.

#### Scenario: Passing step 3 on a phone (manual)

- **WHEN** after the deploy the learner opens Call from Code and calls `hello`
- **THEN** the sheet shows the result and the chat's step 3 win follows
- **AND** no question card on the phone offers "Type it myself"

### Requirement: The phone's spaces are measured

The tutorial frame slice SHALL emit `tutorial_frame_space_changed` whenever
the phone moves between its spaces, with `space` (`chat` or `code`) and `via`:

- `toggle`: the header's switch;
- `swipe`: a sideways swipe;
- `show`: "Show in <file>" on a wrote card;
- `doc`: a doc page opened from a link;
- `log`: a result card's Log;
- `step`: a step picked in the steps sheet.

#### Scenario: Show in a file (manual)

- **WHEN** the learner presses "Show in lib.rs" from Chat
- **THEN** `tutorial_frame_space_changed` reaches the memory provider with
  `space: "code"` and `via: "show"`
