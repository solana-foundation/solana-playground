# Spec Delta

## Purpose

What the console drawer under the stages offers besides the terminal itself:
a copy of the whole log.

## ADDED Requirements

### Requirement: The open console copies its log

While the console drawer is open and the terminal holds output, its bar SHALL
offer Copy log, which copies the terminal's whole text to the clipboard. The
text is read when the drawer opens and when a build or a deploy changes state,
so output a client Run or a typed command prints after that is not in the copy
until the next such change (a known gap, tracked at the TODO in
`ConsoleDrawer.tsx`). Clear empties what Copy log copies. A copy the browser
refuses SHALL tell the user "Could not copy the log." and be logged, not
swallowed.

#### Scenario: Copy the log after a build

- **WHEN** a build finishes and the user opens the console and presses Copy
  log
- **THEN** the clipboard holds the terminal's text, the build's output included

#### Scenario: Nothing to copy

- **WHEN** the console is folded, or the terminal holds no output
- **THEN** no Copy log button is shown

#### Scenario: Clear empties the copy

- **WHEN** the user presses Clear
- **THEN** no Copy log button is shown until the console is opened again or a
  build or a deploy changes state
