# client-v2-failure-states Specification

## Purpose
How client-v2's stages report a failure the person cannot fix from the
message alone: what they say and how they reach the full log.

## Requirements

### Requirement: An unmapped build failure offers the full log

When a build fails before the compiler runs for a reason the product cannot
name (Spec 08 ANY-00), the Build stage SHALL show the title "Could not
build" under the red failure icon, with no duration, and the line "Build
stopped for a reason we can't name. The full log has the details." as its
description, announced as an alert when it shows. "Try again" SHALL be its
brand pill and "Show full log" a link on a line of its own under it. "Show
full log" SHALL open the console drawer, or the console sheet on a phone,
where the terminal holds the build's whole output. A build whose server did
not answer (BUILD-04) SHALL keep "Show details" with the server's address
instead, its reason announced the same way.

#### Scenario: An unmapped build failure opens the log

- **WHEN** a build fails before the compiler with an error the product does
  not map, and the user presses "Show full log"
- **THEN** the console drawer opens with the terminal's output

#### Scenario: The reason of a build that never ran is announced (manual)

- **WHEN** a build fails before the compiler, with or without an answer from
  the server
- **THEN** a screen reader reads the stage's reason line as soon as it shows

#### Scenario: A build server that did not answer keeps its details (manual)

- **WHEN** the build request fails because the server did not answer
- **THEN** the stage reads "Build did not start" and offers "Show details",
  not "Show full log"
