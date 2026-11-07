## ADDED Requirements

### Requirement: The frame carries no stage chrome

In a conversation tutorial's frame, the workspace SHALL show the editor (or
the Call panel) under its head and nothing else: no Write, Build and Deploy
stage tabs, no stage area (a Deploy stage, "Nothing deployed"), and no Steps
or Files column beside it. Building, deploying, running and calling SHALL be
reached only from the chat's cards. The file tree SHALL open only from the
workspace head (the open tab's arrow, the Files tool, ⌘E), and its pin SHALL
still dock it beside the editor. Outside a tutorial the stage tabs, the stage
area and the files column stay as they are.

#### Scenario: Deploy step in the frame (manual)

- **WHEN** a learner reaches Hello Anchor's deploy step in a 1440 × 900 window
- **THEN** the deploy is a card in the chat and the workspace shows `lib.rs`
- **AND** no stage tab, no "Nothing deployed" area and no Steps or Files
  column is on screen

#### Scenario: An ordinary project keeps its stages (manual)

- **WHEN** the learner leaves the tutorial for an ordinary project
- **THEN** the stage tabs and the files column show again

## MODIFIED Requirements

### Requirement: Keyboard paths are listed

"Keyboard shortcuts" in the ⋯ menu SHALL list these keys in three groups,
each under its name:

- In the lesson: ⌘↵ runs the live action, except from the composer; ↵ Start
  or Next; 1 2 3 pick; S skips the question; H shows the question's hint;
- Panels: ⌘B the menu; ⌘E the files; ⌘J the terminal;
- Steps: ⌥↑ ⌥↓ the previous and next step.

None of them SHALL fire while focus is in a text field, except ⌘B, ⌘E and
⌘J. Off a Mac, Ctrl E in the terminal SHALL stay the shell's end of line.

#### Scenario: Typing a digit in the composer

- **WHEN** a question is open and the learner types "1" in the composer
- **THEN** the composer holds "1" and no option is picked

#### Scenario: The shortcuts dialog (manual)

- **WHEN** the learner opens "Keyboard shortcuts" from the ⋯ menu
- **THEN** the keys show under "In the lesson", "Panels" and "Steps", in that
  order
