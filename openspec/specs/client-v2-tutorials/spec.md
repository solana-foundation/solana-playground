# client-v2-tutorials Specification

## Purpose
How client-v2 lists its tutorials and introduces one: the Tutorials page,
the tutorial card it shares with New project, and a tutorial's About page.

## Requirements

### Requirement: The Tutorials page leads with a heading, a search and a filter

The Tutorials page and Home SHALL list only the tutorials of the start
ladder, Hello Anchor (Beginner), Lumberjack (Intermediate) and Zero Copy
(Advanced), in that order; every other tutorial stays registered (its link
and New project's Tutorials list keep it) but leaves the start. Home shows
the three and its link to the Tutorials page reads "All 3".

The Tutorials page SHALL open with the heading "Tutorials" (its only `h1`),
a search field whose placeholder reads "Search <n> tutorials" with `n` the
number of tutorials listed ("Search 3 tutorials"; "Search <framework>
tutorials" while a framework is picked), labelled "Search tutorials", and a
framework filter button beside it, drawn only while the list holds two or
more frameworks. The filter button SHALL be labelled "Filter by framework" while no
framework is picked and "Framework: <name>" while one is, and SHALL open a
menu titled "Framework" with All, Anchor, Seahorse and Native. The search
SHALL match a tutorial's name and description, and the filter its framework;
both apply together. While a search or a filter is on, a status line SHALL
say "<n> results" ("1 result"), or "No tutorials match “<query>”" ("No
<framework> tutorials match …"; "No <framework> tutorials yet" with no
query) when nothing matches.

#### Scenario: The start lists the three v2 lessons

- **WHEN** a user opens Tutorials
- **THEN** Beginner holds Hello Anchor, Intermediate Lumberjack and Advanced
  Zero Copy, the search reads "Search 3 tutorials", and no framework filter
  shows, since all three are Anchor

#### Scenario: Filtering by framework

- **WHEN** the list holds Anchor and Seahorse tutorials and a user opens
  "Filter by framework" and picks Seahorse
- **THEN** only Seahorse tutorials show, the button is labelled
  "Framework: Seahorse", the search reads "Search Seahorse tutorials", and
  a status line gives the count

#### Scenario: A search with no match

- **WHEN** a user types "zzz" in the Tutorials page's search field
- **THEN** the status line reads "No tutorials match “zzz”" and no card shows

### Requirement: A Start here banner leads the page while browsing

While neither a search nor a filter is on, the Tutorials page SHALL show a
banner above the groups with the voxel mark, titled by its tutorial: the
first of the ladder (Hello Anchor, Lumberjack, Zero Copy) not completed, or
Zero Copy once all three are. It SHALL be in one of three states read from
that tutorial's saved progress:

- Not started: the label "Start here", the lesson's line (Hello Anchor
  "Write, deploy and call your first program", Lumberjack "Keep a player's
  state on chain and refill energy over time", Zero Copy "Make accounts
  bigger than a program's memory"), a meta line ("<minutes> min · <m> steps
  · <level> · <framework> · by <author>", or on a phone "<level> · <m> steps
  · <minutes> min"; "<m> pages" and no minutes for a tutorial without a
  definition) and **Start**.
- Started: the label "Continue · Step <n> of <m>", `n` the first step not
  passed (the last step once every step passed and the finish has not shown) ("Continue · Page <n> of <m>" for a tutorial without a definition),
  the line "Next: <that step's objective>" (the description without a
  definition), a meter with "<passed> of <m>", and **Continue**.
- Completed (all three done): the label "Completed" with a tick, the
  lesson's headline without its full stop (Zero Copy "You read 40 KB
  without copying it"), and
  **Open again**; no tutorial after Zero Copy is offered.

The banner's action SHALL open its tutorial as its card does (a definition
on its conversation, any other tutorial on its About page or its page); a
failed open SHALL be said on the banner. A search or a filter SHALL hide
the banner.

#### Scenario: A first visit

- **WHEN** a user who has never opened a tutorial opens Tutorials
- **THEN** the banner reads "Start here" and "Hello Anchor", and its Start
  opens Hello Anchor on its intro card

#### Scenario: Hello Anchor half done

- **WHEN** the learner has passed two of Hello Anchor's four steps and opens
  Tutorials
- **THEN** the banner reads "Continue · Step 3 of 4" and Hello Anchor's
  card reads "2 of 4"

#### Scenario: The banner moves on

- **WHEN** a user who finished Hello Anchor opens Tutorials
- **THEN** the banner reads "Start here" and "Lumberjack", and Hello
  Anchor's card shows its tick

#### Scenario: Everything done

- **WHEN** a user who finished all three opens Tutorials
- **THEN** the banner reads "Completed" and "Zero Copy", with Open again
  and no Start

#### Scenario: The banner gives way to a search

- **WHEN** a user types in the Tutorials page's search field
- **THEN** the banner is gone and the status line shows in its place

### Requirement: Tutorials stand in groups by level

The page SHALL list tutorials in sections by level, Beginner, Intermediate
then Advanced, leaving out a level with no match. Each section SHALL have
its level as an `h2`, the number of its tutorials beside it, and, when it
holds more than four and no search is on, a Show all button (`aria-expanded`)
that shows the rest in place and turns into Show less. A search SHALL show
every match. The cards SHALL be two columns where the page is at least
640 px wide and one below.

#### Scenario: Show all

- **WHEN** a level holds more than four tutorials and a user presses Show
  all under it
- **THEN** every tutorial of that level shows, and the button reads Show
  less with `aria-expanded` true; with one per level, as on the start
  today, no Show all is drawn

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

### Requirement: The Tutorials page is measured

The catalog SHALL send `catalog_filtered` with `page` `tutorials` and
`framework` (`all`, `Anchor`, `Seahorse` or `Native`) when the framework
filter changes, and `catalog_banner_opened` with `banner_state` (`fresh`,
`started` or `completed`) when the banner's action opens its tutorial; a failed
open from the banner SHALL send `catalog_open_failed` with `page`
`tutorials` and be reported, as a card's does.

#### Scenario: Measuring the filter

- **WHEN** a user picks Anchor in the Tutorials page's framework filter
- **THEN** `catalog_filtered` is sent once with `page` `tutorials` and
  `framework` `Anchor`

### Requirement: The About page introduces the tutorial

A tutorial's About page SHALL show "Go back to tutorials", the tutorial's
name as its heading, "by" and its authors, its description, and its details:
Level as a coloured tag ("BEGINNER" in green for Beginner), Framework and
Languages each as an icon and its name in title case ("Seahorse",
"Python", "TypeScript") in a soft box, not the upper-case tag the level uses. Its action SHALL read "Start",
"Continue" once started, or "Completed" with a tick once completed, in that
case, beside the heading from 768 px and pinned full width at the foot of
the page below. A tutorial with a conversation definition has no About
page: it opens on its intro card (`tutorial-flow-v2`,
`tutorial-conversation`).

#### Scenario: Starting from the About page

- **WHEN** a user opens Hello Seahorse's About page and presses Start
- **THEN** the tutorial starts at its first page

#### Scenario: The details read as text

- **WHEN** a user opens Hello Seahorse's About page
- **THEN** Level shows "BEGINNER" and Framework and Languages read
  "Seahorse", "Python" and "TypeScript" (manual: green tag, title-case
  boxes)

### Requirement: Beside a tutorial not yet started, the files column is empty and the assistant names it when no project is open

While a tutorial that is not started is on screen, the files column SHALL
hold nothing (no callout, no "Create a new project", no other project's
files). While, in addition, no project is open, the assistant's head SHALL
read the tutorial's name and its empty conversation SHALL be titled "Ask
about <tutorial>"; an open project keeps the assistant under its own name,
since the conversation and the tools still act on it. Once the tutorial
starts, both follow the tutorial's project as for any project.

#### Scenario: The assistant beside Hello Seahorse

- **WHEN** a user with no project opens Hello Seahorse's About page
- **THEN** the assistant's head reads "Hello Seahorse", its empty state
  reads "Ask about Hello Seahorse", and the files column shows no "Create a
  new project"

#### Scenario: Beside another project

- **WHEN** a user whose project e2e-project is open opens Hello Seahorse's
  About page
- **THEN** the assistant's head reads "e2e-project" and the files column
  shows neither e2e-project's files nor "Create a new project"

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
