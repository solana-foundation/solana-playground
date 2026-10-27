# Spec Delta

## Purpose

Where an open lesson shows itself in the frame: the objective band over the
editor, the steps beside the files, and the lesson's page inside the stage,
on a wide screen and on a phone.

## ADDED Requirements

### Requirement: An open lesson shows its objective band over the editor

While a lesson is open, the stage SHALL show the objective band
(`data-slot="objective-band"`) above the editor, carrying the step's position
("Step n of m"), its objective, a progress meter (`role="progressbar"`),
"Previous step" and "Next step", "Read the page" and "I'm stuck".

#### Scenario: The objective band over the editor

- **WHEN** a tutorial is started on a 1280 px wide screen
- **THEN** the band above the editor says "Step 1 of 4" and the first step's
  objective
- **AND** it shows the progress meter, "Previous step", "Next step",
  "Read the page" and "I'm stuck"

### Requirement: The steps sit beside the files

While a lesson is open, the files column SHALL offer a Steps | Files switch
and, on Steps, the lesson's steps as a step rail (`data-slot="step-rail"`)
marking each step `done`, `skipped`, `current` or `locked`. "Skip this step"
SHALL be offered at the rail's foot while the current step is the furthest
one reached and nothing has proved it.

#### Scenario: Steps beside the files

- **WHEN** a tutorial is started
- **THEN** the files column shows Steps selected and Files beside it
- **AND** the first step is marked `current` and the others `locked`

#### Scenario: Skipping marks the step skipped

- **WHEN** the learner presses "Skip this step" on the first step
- **THEN** the first step is marked `skipped`
- **AND** the second step is marked `current`

#### Scenario: Re-entering lands on the same step

- **WHEN** the learner has moved to the second step, leaves the tutorial and
  opens it again
- **THEN** the band says "Step 2 of 4" and the second step is marked `current`

### Requirement: The lesson's page opens inside the stage

"Read the page" SHALL open the step's page as a non-modal dialog inside the
stage, covering the editor and not the band; nothing else opens it. Escape SHALL close it and
return focus to the control that opened it.

#### Scenario: The page opens beside the band, not over it

- **WHEN** the learner presses "Read the page"
- **THEN** the step's page covers the editor
- **AND** the band's "Next step" can still be pressed
- **WHEN** the learner presses Escape
- **THEN** the page closes and focus is back on "Read the page"

### Requirement: The band folds to one row on a phone

Below the phone width the objective band SHALL fold to one row holding the
position and the objective, which opens in place to show how the step is
checked; the band's actions SHALL sit in a bar at the foot of the code
(change lesson-prototype-polish, "The phone's lesson bar").

#### Scenario: The band and the bar on a phone

- **WHEN** a tutorial is started on a 393 px wide screen
- **THEN** the band shows "1/4" and the objective on one row
- **AND** "Read the page" and "I'm stuck" sit in the bar at the foot
