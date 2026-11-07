# Spec Delta

## MODIFIED Requirements

### Requirement: The navigation opens the gallery and the pages

While a page shows, Home in the navigation SHALL close it, and SHALL do
nothing else when Home is under the page. Otherwise Home SHALL show Home,
and leave Home in place while Home shows, except over a shared project,
which the project list cannot name: there it SHALL go back to the work.
New project, Tutorials and Programs SHALL open the New project, Tutorials
and Programs pages, with the item of the page shown marked current, and no
dialog.

#### Scenario: Programs from the navigation

- **WHEN** a user clicks Programs in the navigation
- **THEN** the Programs page shows, with its search field and the program
  cards, Programs is marked current in the navigation, and no dialog opens

#### Scenario: New project from the navigation

- **WHEN** a user clicks New project in the navigation
- **THEN** the New project page shows, New project is marked current in the
  navigation, and no dialog opens

### Requirement: Tutorials and Programs are pages

The Tutorials and Programs pages SHALL take the place of the assistant and
the work, with the navigation beside them, under a column bar that names
the page. Each SHALL hold a search field that filters its cards by name and
description (a program's by its categories too) and a grid of cards, two
columns from 720 px and one below, each with an Open action. Opening a
tutorial SHALL open it in the work; opening a program SHALL import it as a
project and open it. A page SHALL close when one of its cards opens, when a
tutorial's route opens, when another page, Home or a project in the project
list is picked, when the product asks for the assistant over the work, and
on nothing else the user did; a project open before
the page SHALL come back as it was. The routes
`/new`, `/tutorials` and `/programs` SHALL open their page.

#### Scenario: Finding a tutorial by search

- **WHEN** a user opens Tutorials from the navigation, types "seahorse" in
  its search field and opens "Hello Seahorse"
- **THEN** only the matching cards show while the query stands, and the
  tutorial opens in the work, with its step in the stage

#### Scenario: A program opens as a project

- **WHEN** a user opens Programs from the navigation and opens a program
- **THEN** the program is imported as a project and opens in the work

#### Scenario: Back to the open project

- **WHEN** a user with a project open, and a file open in the editor, opens
  Tutorials from the navigation and then picks that project in the project
  list
- **THEN** the page closes and the editor shows the same file

#### Scenario: The pages on a phone

- **WHEN** a user on a 390 px wide screen picks Tutorials on the menu page
- **THEN** the work page shows "Tutorials" in its bar and the cards in one
  column

#### Scenario: The pages by link

- **WHEN** a user opens `/programs`
- **THEN** the Programs page shows

#### Scenario: New project by link

- **WHEN** a user opens `/new`
- **THEN** the New project page shows

### Requirement: The pages are measured

The pages SHALL send `catalog_shown` with `page` (`new-project`,
`tutorials` or `programs`) and `via` (`nav`, `home`, `link`, `lesson` for
the lesson band's Browse gallery, or `editor` for the empty editor's Start
a project) when a page shows;
`catalog_searched` with `page` and `empty` once typing in the search field
has rested for 500 ms on a non-empty query; `catalog_item_opened` with
`page` when an Open succeeds; and `catalog_open_failed` with `page` when it
fails. A failed Open and a program list that cannot be read SHALL be
reported.

#### Scenario: Searching tutorials

- **WHEN** a user types "zzz" in the Tutorials page's search field and
  stops typing
- **THEN** `catalog_searched` is sent once with `page` `tutorials` and
  `empty` true

### Requirement: New project asks what to build

New project SHALL be a page like Tutorials and Programs, under a column bar
named "New project", that holds the line "Start clean, open a real program,
or learn through a tutorial. Everything stays in this browser until you
deploy.", then Start from scratch (a framework, a project name and Start), then
Tutorials and Programs as one choice with a count each beside a search
field, then the chosen list's cards as the pages draw them. No dialog named
"What do you want to build?" SHALL exist. The navigation's New project,
Home's New project tile, the lesson band's Browse gallery and the empty
editor's Start a project SHALL open the page. Start SHALL make a project from the framework's starter and close the
page; opening a card SHALL open its tutorial or import its program and
close the page, and a failure SHALL stay on its card. On a phone every
card, here and on the other pages, SHALL be one target that ends in a
chevron.

#### Scenario: Starting an Anchor project from New project

- **WHEN** a user opens New project from the navigation, keeps Anchor,
  names the project and presses Start
- **THEN** the page closes and the new project is the current one

#### Scenario: Opening a program from New project

- **WHEN** a user opens New project, picks Programs and opens a program
- **THEN** the page closes and the program opens as a project

#### Scenario: New project's controls line up

- **WHEN** a user opens New project at 1280 px
- **THEN** the framework chips, the name field and Start share one height,
  the name field and Start share a centre line under the framework row

#### Scenario: New project on a phone is a page

- **WHEN** a user on a 390 px wide screen opens New project
- **THEN** the work page shows "New project" in its bar, with no sideways
  scroll, and each card ends in a chevron

### Requirement: A start with no project opens on Home

A page load on `/` with no project SHALL show Home in place of the
assistant and the work, with the navigation beside it (on a phone, its menu
page), and SHALL NOT open the New project page. Home SHALL hold the question "Where
should we begin?" and a composer that opens the assistant. From 768 px it
SHALL hold three tiles, New project, Follow a tutorial and Open a program,
and four tutorial cards; the three SHALL open the New project, Tutorials
and Programs pages in Home's place. Below 768 px it SHALL hold quick starts for a new Anchor
project and a beginner tutorial, a Browse row that opens the Tutorials
page, and the composer at its foot. Home SHALL give way to the work once a
project is created or opened or a tutorial opens; projects listed
with none open SHALL still show Home. Until the projects are known Home's
place SHALL show a spinner, and if they are not known within 10 s the page
SHALL report it and open the work. The editor SHALL NOT mount while Home
shows with no project open.

#### Scenario: An empty install

- **WHEN** a user with no project opens `/` on a 1280 px wide window
- **THEN** Home shows "Where should we begin?", the composer, the three
  tiles and four tutorial cards, no page opens, and no editor is mounted

#### Scenario: New project from Home

- **WHEN** a user on Home clicks New project, then names the project on the
  New project page and starts it
- **THEN** Home gives way to the work, with the new project's files in the
  files column and its default file in the editor

#### Scenario: A tutorial from Home

- **WHEN** a user on Home opens a tutorial card
- **THEN** the tutorial opens in the work, with its step in the stage

#### Scenario: Tiles that open a page

- **WHEN** a user on Home clicks Open a program
- **THEN** the Programs page shows in Home's place, and no dialog opens

#### Scenario: Home on a phone

- **WHEN** a user with no project opens `/` on a 390 px wide screen
- **THEN** the work page shows "Home" in its bar, the question, the quick
  starts for a new Anchor project and a beginner tutorial, the Browse row
  and the composer, and "New Anchor project" opens a new project on the code

#### Scenario: The composer on Home

- **WHEN** a user on Home on a 1280 px wide window clicks the composer
- **THEN** the assistant opens

