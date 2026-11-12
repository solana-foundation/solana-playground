## ADDED Requirements

### Requirement: A project's work column has one bar

From 768 px wide, an open project SHALL draw no stage bar
(`[data-slot="stage-bar"]`) over its work column: the stage tabs and the
editor head are all that sit over the stage. The project's name SHALL be
shown in the assistant's head instead. Home and the cover pages SHALL keep
their bar, titled as before. The assistant's toggle SHALL NOT be in the
editor head while the assistant is shown, wide or as the Sheet below
1024 px.

#### Scenario: No stage bar in a project

- **WHEN** a user opens `e2e-project` on a 1440 px wide window
- **THEN** no `[data-slot="stage-bar"]` is in the work column and the
  assistant's head reads "e2e-project"

#### Scenario: Home keeps its bar

- **WHEN** a user opens Home
- **THEN** the bar over the page reads "Home"
