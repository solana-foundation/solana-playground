# Spec Delta

## Purpose

How client-v2 lists its tutorials and introduces one: the Tutorials page,
the tutorial card it shares with New project, and a tutorial's About page.

## ADDED Requirements

### Requirement: The Tutorials page leads with a heading, a search and a filter

The Tutorials page SHALL open with the heading "Tutorials" (its only `h1`),
a search field whose placeholder reads "Search <n> tutorials" with `n` the
number of tutorials (or "Search <framework> tutorials" while a framework is
picked), labelled "Search tutorials", and a framework filter button beside
it. The filter button SHALL be labelled "Filter by framework" while no
framework is picked and "Framework: <name>" while one is, and SHALL open a
menu titled "Framework" with All, Anchor, Seahorse and Native. The search
SHALL match a tutorial's name and description, and the filter its framework;
both apply together. While a search or a filter is on, a status line SHALL
say "<n> results" ("1 result"), or "No tutorials match “<query>”" ("No
<framework> tutorials match …"; "No <framework> tutorials yet" with no
query) when nothing matches.

#### Scenario: Filtering by framework

- **WHEN** a user opens Tutorials, opens "Filter by framework" and picks
  Seahorse
- **THEN** only Seahorse tutorials show, the button is labelled
  "Framework: Seahorse", the search reads "Search Seahorse tutorials", and
  a status line gives the count

#### Scenario: A search with no match

- **WHEN** a user types "zzz" in the Tutorials page's search field
- **THEN** the status line reads "No tutorials match “zzz”" and no card shows

### Requirement: A Start here banner leads the page while browsing

While neither a search nor a filter is on, the Tutorials page SHALL show a
banner above the groups, titled by its tutorial, in one of three states read
from the tutorials' saved progress:

- Hello Anchor not started: the label "Start here", the line "Write, deploy
  and call your first Solana program", a meta line (pages, level, framework,
  author) and **Start**.
- Hello Anchor started and not completed: the label "Pick up where you left
  off", "Page <n> of <m>" with a meter, and **Continue**.
- Hello Anchor completed: the banner names Counter PDA Tutorial with the
  label "Up next" and **Start**, or, once that one is started, "Pick up where
  you left off", its page and **Continue**.

The banner's action SHALL open its tutorial and start it at once, without
stopping on the About page. A search or a filter SHALL hide the banner.

#### Scenario: A first visit

- **WHEN** a user who has never opened a tutorial opens Tutorials
- **THEN** the banner reads "Start here" and "Hello Anchor", and its Start
  opens Hello Anchor at its first page

#### Scenario: Hello Anchor half done

- **WHEN** a user who left Hello Anchor on page 2 opens Tutorials
- **THEN** the banner reads "Pick up where you left off" and "Page 2 of
  <m>", and Continue opens page 2

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

- **WHEN** a user opens Tutorials and presses Show all under Beginner
- **THEN** every Beginner tutorial shows, and the button reads Show less
  with `aria-expanded` true

### Requirement: A tutorial card opens its tutorial

A tutorial card SHALL show the tutorial's cover, its name, its description
(at most two lines), and a caption: "<framework> · by <first author>" inside
a level section, "<level> · <framework>" elsewhere. Its action SHALL be one
button over the whole card, labelled "Open <name>", "Continue <name>" once
started, or "<name> completed. Open it" once completed, drawn as a square in
the card's corner holding ↗, or a green tick once completed. A started
tutorial SHALL show "<n> of <m>" (its page of its pages) beside its name. On
a screen under 768 px the corner square SHALL give way to a chevron at the
card's end, except that a completed tutorial's card keeps its tick. A failed
open SHALL say why on the card. The cover SHALL be the brand mark in white
on a ground chosen by the tutorial's framework, the same for a tutorial on
every load, and decorative (hidden from assistive technology). The New project
dialog's Tutorials list SHALL use the same card, with the "<level> ·
<framework>" caption.

#### Scenario: Opening a tutorial from its card

- **WHEN** a user opens Tutorials and presses "Open Hello Seahorse"
- **THEN** Hello Seahorse's About page shows

#### Scenario: A started tutorial's card

- **WHEN** a user who left Counter PDA Tutorial on page 2 opens Tutorials
- **THEN** its card shows "2 of <m>" beside its name and its button is
  labelled "Continue Counter PDA Tutorial"

#### Scenario: New project lists the same cards

- **WHEN** a user opens New project and picks Tutorials
- **THEN** the tutorial cards show their covers and ↗ buttons labelled
  "Open <name>" (manual: the look)

### Requirement: The Tutorials page is measured

The catalog SHALL send `catalog_filtered` with `page` `tutorials` and
`framework` (`all`, `Anchor`, `Seahorse` or `Native`) when the framework
filter changes, and `catalog_banner_opened` with `state` (`fresh`,
`started` or `next`) when the banner's action opens its tutorial; a failed
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
Languages each as an icon and its name in title case ("Anchor", "Rust",
"TypeScript") in a soft box, not the upper-case tag the level uses. Its action SHALL read "Start",
"Continue" once started, or "Completed" with a tick once completed, in that
case, beside the heading from 768 px and pinned full width at the foot of
the page below.

#### Scenario: Starting from the About page

- **WHEN** a user opens Hello Anchor's About page and presses Start
- **THEN** the tutorial starts at its first page

#### Scenario: The details read as text

- **WHEN** a user opens Hello Anchor's About page
- **THEN** Level shows "BEGINNER" and Framework and Languages read
  "Anchor", "Rust" and "TypeScript" (manual: green tag, title-case boxes)

### Requirement: Beside a tutorial not yet started, the files column is empty and the assistant names it when no project is open

While a tutorial that is not started is on screen, the files column SHALL
hold nothing (no callout, no "Create a new project", no other project's
files). While, in addition, no project is open, the assistant's head SHALL
read the tutorial's name and its empty conversation SHALL be titled "Ask
about <tutorial>"; an open project keeps the assistant under its own name,
since the conversation and the tools still act on it. Once the tutorial
starts, both follow the tutorial's project as for any project.

#### Scenario: The assistant beside Hello Anchor

- **WHEN** a user with no project opens Hello Anchor's About page
- **THEN** the assistant's head reads "Hello Anchor", its empty state reads
  "Ask about Hello Anchor", and the files column shows no "Create a new
  project"

#### Scenario: Beside another project

- **WHEN** a user whose project e2e-project is open opens Hello Anchor's
  About page
- **THEN** the assistant's head reads "e2e-project" and the files column
  shows neither e2e-project's files nor "Create a new project"
