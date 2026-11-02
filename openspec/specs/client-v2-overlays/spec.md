# client-v2-overlays Specification

## Purpose
What client-v2 draws over the work (dialogs, toasts, tooltips) and how each tells the user how long it stays and what it waits on.

## Requirements

### Requirement: A timed toast shows how long it stays

A toast that closes by itself SHALL show a thin bar in the accent colour
along its foot (`data-slot="toast-progress"`), full when the toast opens and
empty when it closes, draining at an even pace over the toast's duration. The
bar SHALL stop while the toast's timer is paused (the pointer over the
toasts, or the page hidden) and go on from there. A toast shown again by its
id SHALL start its bar again from full, as its timer starts again. A persistent toast SHALL show no bar. Under
reduced motion the bar SHALL NOT be drawn. The bar SHALL be hidden from
assistive technology.

#### Scenario: A timed toast drains (manual)

- **WHEN** the product shows a toast with the default duration
- **THEN** the toast has a `toast-progress` bar whose animation lasts that
  duration and runs from full width to none

#### Scenario: A persistent toast has no bar (manual)

- **WHEN** the product shows a persistent toast
- **THEN** the toast has no `toast-progress` bar

#### Scenario: The bar waits while the toasts are hovered (manual)

- **WHEN** a user rests the pointer on a timed toast halfway through its
  duration, then moves it away
- **THEN** the bar stops at about half while the pointer rests and the toast
  closes when the bar runs out, not before

#### Scenario: A toast shown again starts its bar again (manual)

- **WHEN** the product shows a toast, then shows it again by the same id
- **THEN** the toast's `toast-progress` bar is drawn anew, from full width

#### Scenario: Reduced motion (manual)

- **WHEN** a user who prefers reduced motion is shown a timed toast
- **THEN** no bar is drawn and the toast still closes after its duration
