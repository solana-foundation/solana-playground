## ADDED Requirements

### Requirement: The feed reads on the 31 Oct scale

A tutorial's chat feed SHALL set its type on the scale of Almaz's prototype
at `f7d42bf2e` (`ui/type.ts`), in CSS pixels as size / line height / weight:

- the assistant's text: 16 / 24 at 320, in the text colour at 80%;
- a step's heading: 24 / 28 at 500;
- a card's heading (the intro's "How it goes", the finish's "What you
  learned"): 20 / 24 at 500;
- the intro's title: 24 / 28 at 500;
- a quiz question: 18 / 26 at 500;
- a quiz option's code: monospace 14 / 24;
- the win and finish headlines: 28 / 32 at 500.

Code in ticks SHALL sit on one chip: a ground darker than the surface under
it with a 1 px inset white ring at 18%, monospace 14 px on a 16 px line at
weight 350, 4 px a side and 3 px above and below (22 px tall); 12 px with
3 px a side for small notes, and 5 px above for the quiz question. A stop
right after a chip SHALL stay on the chip's line. Headlines and step headings
SHALL carry no closing period.

The act and result cards are outside this requirement.

#### Scenario: Text and code in an assistant turn (manual)

- **WHEN** the intro of Hello Anchor's first step is shown in a 1440 × 900
  window
- **THEN** its text is 16 px on a 24 px line at weight 320
- **AND** `#[program]` in it sits on a 22 px chip with a ringed edge

#### Scenario: A quiz question (manual)

- **WHEN** step 1's question card is live
- **THEN** its question is 18 px on a 26 px line and each option's code is
  14 px monospace on a 24 px line

### Requirement: The feed keeps the prototype's rhythm

The feed SHALL start 22 px under the step head. Paragraphs of one reply SHALL
stand 15 px apart; a step's heading SHALL stand 30 px under the turn above it
and 9 px over the text under it; a listing SHALL sit 9 px under the text it
follows, and text resuming after a listing or a card SHALL start 24 px under
it. A card that waits on the learner (the live question or act) SHALL step
out to 8 px from the column's edges.

#### Scenario: A jumped-to heading lands where the first one sits (manual)

- **WHEN** the learner picks step 1 from the step head while on step 2
- **THEN** step 1's heading comes to rest 22 px under the feed's top, as the
  first heading sits on load

### Requirement: Reduced motion fades new turns in

With `prefers-reduced-motion: reduce`, a turn that arrives SHALL fade in over
240 ms, shown whole, with no rise and no typing. Turns already on screen at
load SHALL show at once.

#### Scenario: A new reply with reduced motion (manual)

- **WHEN** reduced motion is on and the assistant posts a reply
- **THEN** the reply fades in whole, with nothing moving or typing

### Requirement: A wrote card ends on the lines it leaves out

A wrote card SHALL head with the file's path alone. It SHALL show at most the
first three lines of the run written, and when the run is longer, end on a
row "⋯ N more lines" ("1 more line" for one) in place of the line range. Its
`aria-label` SHALL still read "Show <range> in <file>".

#### Scenario: A thirteen-line write (manual)

- **WHEN** the assistant writes lines 5 to 13 of `lib.rs`
- **THEN** the wrote card shows lines 5, 6 and 7 and ends on "6 more lines"
- **AND** its head reads `src/lib.rs` with no "lines 5 to 13"
