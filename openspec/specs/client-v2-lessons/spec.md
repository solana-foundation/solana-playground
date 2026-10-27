# client-v2-lessons Specification

## Purpose
How an open lesson looks, polished to the original design-system prototype:
the one-row band, the page, the rail, the assistant's first offer, the
lesson's row in the navigation, and the phone's band and bar.

## Requirements

### Requirement: A lesson opens on its code

Entering a lesson SHALL show the step's files in the editor with the page
closed. The page SHALL open only from "Read the page". The band's control
SHALL read "Read the page" whether or not the page has been opened.

#### Scenario: Starting a tutorial lands on the code

- **WHEN** a tutorial is started on a 1440 px wide screen
- **THEN** the editor shows `lib.rs` and no page covers it
- **AND** the band offers "Read the page"

#### Scenario: The page has no footer

- **WHEN** the learner presses "Read the page"
- **THEN** the page shows the objective as its head and a "Close the page"
  button
- **AND** it has no "Back to the code" and no "Mark as read"

### Requirement: The objective band is one row

On a screen from the phone width up, the objective band SHALL be one row: the
position as "Step n of m", the progress meter, the objective, and a "How this
step is checked" toggle, then "Previous step", "Next step", "Read the page"
(when the step has a page) and the step's primary action at the row's end.
The primary action SHALL be "Continue" on a step proved by reading that is
still to be marked, and the assistant's label ("I'm stuck" and its later
rungs) on any other. When they
do not fit, the actions SHALL wrap under the objective as one group. The
toggle SHALL show how the step is checked on a line under the row. The band
SHALL offer no proving action and show no readiness line.

#### Scenario: One row at 1440

- **WHEN** a tutorial is started on a 1440 px wide screen
- **THEN** the band is one row 40 px high reading "Step 1 of 4"
- **AND** it shows no "Build to prove this" and no "Before you can deploy"

#### Scenario: One row at 834

- **WHEN** a tutorial is started on an 834 px wide screen
- **THEN** "Read the page" and "I'm stuck" sit on the same row as the
  objective

#### Scenario: How the step is checked

- **WHEN** the learner presses "How this step is checked"
- **THEN** the line "Verified when the built interface shows a hello
  instruction." shows under the row and the toggle is `aria-expanded="true"`

### Requirement: The step rail reads as the prototype's

The step rail SHALL show each title in full, wrapping if needed, and under it
"aiming at build" or "aiming at deploy" for the current step, "locked" for a
step not reached, and "skipped — not verified" for a skipped one. "Skip this
step" SHALL be a full-width footer of the column.

#### Scenario: Statuses on entry

- **WHEN** a tutorial is started
- **THEN** the first step reads "aiming at build" and the others "locked"

### Requirement: The assistant offers the lesson's questions

While a lesson is open, the empty thread SHALL offer "Explain this step",
"Give me a hint" and "Why did my build fail?"; outside a lesson it SHALL
offer "What does this program do?", "Why did my build fail?" and "How do I
deploy this?". The composer's context chips SHALL read, in this order, the
step ("Step n of m"), the active file's name, and the file count.

#### Scenario: Suggestions in a lesson

- **WHEN** a tutorial is started and the assistant has no messages
- **THEN** it offers "Explain this step", "Give me a hint" and "Why did my
  build fail?"
- **AND** the chips read "Step 1 of 4", "lib.rs", "1 file"

### Requirement: The phone's lesson bar

Below the phone width the band SHALL be one 52 px row holding "n/m", the
objective and a caret; pressing it SHALL open the row in place to show the
whole objective and how the step is checked. "Previous step", "Next step",
"Read the page" and the primary action SHALL sit in a bar at the foot of the
code, each at least 48 px high. The Files sheet opened from the files row
SHALL open on Files.

#### Scenario: The band and the bar on a phone

- **WHEN** a tutorial is started on a 393 px wide screen
- **THEN** the band shows "1/4" and the objective on one row with no other
  control
- **AND** a bar at the foot shows "Previous step", "Next step", "Read the
  page" and "I'm stuck"
- **WHEN** the learner presses the band
- **THEN** it is `aria-expanded="true"` and shows how the step is checked
