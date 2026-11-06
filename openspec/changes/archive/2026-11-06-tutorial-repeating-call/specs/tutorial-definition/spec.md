## ADDED Requirements

### Requirement: A call act may repeat

A `call` act MAY have `repeat`: a required `label`, the second button's name,
and an optional `until`, a log pattern read as a goal's `log` is. `yarn
tutorial:check` SHALL refuse `repeat` on any other act, an `until` that does not
compile, an `until` on the step's last beat, an `until` on a card whose step goal
reads the log of the same call, and, with no `until`, a step whose
goal is not a `call` or `refused` goal of the card's own instruction, since
nothing could then end the card.

#### Scenario: A repeat nothing can end (manual)

- **GIVEN** a call act with `repeat` and no `until`, in a step whose goal is `deploy`
- **WHEN** the check runs
- **THEN** it fails with the beat's path and says what would end the card
