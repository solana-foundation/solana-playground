## ADDED Requirements

### Requirement: A repeating call card

A call act whose definition has `repeat` SHALL stay one card across its presses.
Each press SHALL run one call and add one line to the card: a check and the
program's log line and the short signature, or a cross and the refusal. The
live card SHALL show the last three lines, newest last, and the record it leaves
SHALL show them all.

After a first press by hand, while every press has landed, the card SHALL offer
a second button named by `repeat.label`. That button SHALL run the presses one
after another, 250 ms apart, and its label SHALL read "Stop" while it does. Stop,
or any press that did not land, SHALL end the repetition; a call already in
flight SHALL finish. A reload SHALL NOT resume the repetition, since a run is
never repeated by the engine. A press that failed, including a refusal the step's
goal does not name, SHALL post its failed result card as any other call does, and
adds no line. The finished card SHALL read its `record` and the count ("Grew 4
times"), or its plain record when the step passed with no press.

The card SHALL end when the step's goal passes, or when a press's log line
matches `repeat.until`. On `repeat.until` the lesson SHALL flow on to the next
beat, and the card SHALL take no more presses. Without either, the card SHALL
stay live, and a press that landed SHALL post nothing else. Each press SHALL
fire `tutorial_action_run`, and the card SHALL add no event of its own.

#### Scenario: Chopping until the program refuses (manual)

- **GIVEN** a chop step whose goal is the program's `NotEnoughEnergy` refusal
- **WHEN** the learner presses Chop once, then "Chop until out of energy"
- **THEN** a line is added per chop and the button reads "Stop" meanwhile
- **AND** the refusal adds its line, ends the repetition and passes the step

#### Scenario: Growing to a size before the next act (manual)

- **GIVEN** a Grow card with `repeat.until` matching the 40 KB log line, followed
  by a Paint act
- **WHEN** the press that logs 40 KB lands
- **THEN** the card becomes its record, with one line per press
- **AND** the Paint card follows, and pressing Grow again does nothing

#### Scenario: Stop (manual)

- **WHEN** the learner presses Stop while a call is in flight
- **THEN** that call finishes and adds its line, and no further call is sent

### Requirement: The engine remembers the accounts calls wrote to

When a run or call lands, the engine SHALL remember each account the call wrote
to, other than the wallet, by its name in the IDL, with the latest address
winning. The memory SHALL be saved with the conversation's progress, so a reload
keeps it, and Start over SHALL clear it, while a step's Reset SHALL keep it, since
the step's create call replaces it. A save without it SHALL read as empty.

Every later call act and Call panel call SHALL send a remembered address for an
account of the same name, over a Test form generator that derives nothing, so
not for an account the IDL marks as a signer or one from seeds. The Call panel's
half lands with HOO-2358. A call made from the Call panel SHALL be remembered
the same way as one made from a card.

#### Scenario: A map survives a reload (manual)

- **GIVEN** `init_map` landed and wrote to `map`
- **WHEN** the learner reloads and presses Grow, whose `map` has no seeds
- **THEN** the call targets the address `init_map` wrote to
