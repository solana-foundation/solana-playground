## ADDED Requirements

### Requirement: The Tutorials page's search folds on a phone

On a screen under 768 px the Tutorials page's search SHALL fold to a 44 px glass
labelled "Search tutorials", beside the heading and the filter. Pressing it
SHALL open the field across the whole row, with the focus in it, and a Cancel
button beside it, hiding the heading and the filter. Cancel SHALL clear the
search and fold it back. Esc SHALL clear what was typed, then fold it back. The
phone's bar over the page SHALL keep only the menu, with no name and no rule: the
page's own heading names it.

#### Scenario: Searching on a phone

- **WHEN** a user on a 393 px screen presses the glass and types "lumber"
- **THEN** the field takes the row with Cancel beside it and only Lumberjack's
  card shows, and Cancel brings back the heading, the glass and every card

## MODIFIED Requirements

### Requirement: A tutorial card opens its tutorial

A tutorial card SHALL show the tutorial's cover, a word over its name, its name
(at most two lines), and its description (at most two lines). The word over the
name SHALL be the tutorial's framework inside a level section and "<level> ·
<framework>" elsewhere; a card SHALL NOT name the tutorial's author. Its action
SHALL be one button over the whole card, labelled "Open <name>", "Continue
<name>" once started, or "<name> completed. Open it" once completed, drawn on
every screen as a square in the card's corner holding ↗, or a green tick once
completed. A started tutorial SHALL show "<n> of <m>" (its page of its pages)
beside its name. A failed open SHALL say why on the card. The cover SHALL be the
brand mark in white on a ground chosen by the tutorial's framework, the same for
a tutorial on every load, and decorative (hidden from assistive technology). The
New project dialog's Tutorials list SHALL use the same card, with the "<level> ·
<framework>" word.

#### Scenario: Opening a tutorial from its card

- **WHEN** a user opens Tutorials and presses "Open Lumberjack"
- **THEN** Lumberjack's About page shows

#### Scenario: A started tutorial's card

- **WHEN** a user who left Lumberjack on page 2 opens Tutorials
- **THEN** its card shows "2 of <m>" beside its name and its button is
  labelled "Continue Lumberjack"

#### Scenario: The word over a card's name

- **WHEN** a user opens Tutorials
- **THEN** Hello Anchor's card shows "Anchor" over its name, and "by acheron"
  nowhere on it (manual: the look)

#### Scenario: A card on a phone

- **WHEN** a user opens Tutorials on a 393 px screen
- **THEN** each card shows its corner square with ↗, or its tick once
  completed, and no chevron (manual: the look)

#### Scenario: New project lists the same cards

- **WHEN** a user opens New project and picks Tutorials
- **THEN** the tutorial cards show their covers, "<level> · <framework>" over
  their names and ↗ buttons labelled "Open <name>" (manual: the look)
