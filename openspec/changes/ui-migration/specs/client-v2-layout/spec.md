# Spec Delta

## Purpose

How the IDE's panels are arranged, what of that arrangement survives a
reload, how it changes with the width of the screen, and what a phone shows.

## ADDED Requirements

### Requirement: The layout survives a reload

The product SHALL restore, after a reload on the same device, which panels
were open and the sizes the user dragged them to. A saved layout it cannot
read SHALL give the default layout without breaking the page.

#### Scenario: A resized assistant and an open console

- **WHEN** a user widens the assistant, opens the console and reloads
- **THEN** the assistant has the width it was given and the console is open

#### Scenario: A layout saved before the four columns

- **WHEN** a user whose saved layout is from the version with the header
  (project panel folded, console open) loads the product
- **THEN** the files column is folded, the console is open, the navigation
  is open, and the saved layout is rewritten in the current version

#### Scenario: An unreadable saved layout

- **WHEN** the saved layout is corrupt and the user loads the product
- **THEN** the default layout appears and the product works

#### Scenario: A layout saved before the column bars

- **WHEN** a user whose saved layout was written before the column bars
  (files column folded, assistant open and resized) loads the product
- **THEN** the files column is hidden and the assistant is open at the width
  it was given

### Requirement: Panels fold without losing their state

Folding a panel SHALL hide it without discarding what it holds.

#### Scenario: Folding the console

- **WHEN** a user runs a command in the console, folds it and opens it again
- **THEN** the terminal shows the same session and its output

#### Scenario: Folding the project panel

- **WHEN** a user presses ⌘E with the files column open, then clicks
  "Expand project panel" in the stage bar
- **THEN** the column hides and takes no width, then opens at the width it
  last had

#### Scenario: The files column keeps its tree

- **WHEN** a user opens a folder, hides the files column with ⌘E and shows
  it again, then does the same with the stage bar's toggle
- **THEN** the folder is still open, the current file is still selected and
  the tree is scrolled where it was

#### Scenario: A lesson's column keeps its tab

- **WHEN** a user in a lesson picks the Files tab, hides the column and
  shows it again
- **THEN** the Files tab is still selected

#### Scenario: Folding the navigation

- **WHEN** a user presses ⌘B with the navigation open, then again
- **THEN** the navigation folds to a rail of icons, then opens at its full
  width

### Requirement: The terminal greets once

The console's terminal SHALL print its welcome and its prompt once per page
load, however many times React runs its effects.

#### Scenario: The terminal greets once

- **WHEN** a user opens the console on a fresh page load
- **THEN** the terminal shows one welcome and a single `$` prompt

### Requirement: A phone is three pages

Below 768 px wide the product SHALL show three pages side by side, moved
between by a swipe or by the buttons in each page's bar: the menu (the
navigation), the work page (the assistant or the code, switched by Chat and
Code) and the preview (the current stage over the console). A load SHALL
land on the work page showing the code. The code editor SHALL edit at every
width. The 768 px value SHALL be held in one place.

#### Scenario: A phone

- **WHEN** a user on a 390 px wide screen opens a project, types in the
  editor, picks another file from "Files", opens "Preview the build", goes
  "Back to the code", opens "Menu" and then Chat
- **THEN** the code changes, the other file opens, the Build stage shows
  over the console, the code is shown again, the navigation fills the
  screen, and the assistant accepts a prompt

#### Scenario: Turning a phone across 768 px

- **WHEN** a user with a file open and a command run in the console widens
  the window from 390 px to 1024 px and back
- **THEN** the same file is open with its edits, the console shows the same
  session, and the saved layout is as it was before

#### Scenario: A portrait iPad

- **WHEN** a user opens a project on a 768 px wide screen and types in the
  editor
- **THEN** the code changes

### Requirement: The editor does not take focus from a field

Opening a file SHALL focus the editor. The exception is an open the user
did not start: the open the editor makes as it mounts (on a slow first load
it mounts late and opens the current file then, or the first file opened
after it when none was current), and a re-open or reload of the workspace
that sync makes (taking the account's copy, merging with another device,
following another tab's write). If the user is typing in a text field outside
the editor at that moment, the file SHALL still open, and the field SHALL
keep its focus and what was typed. After the mount, a field in the
explorer's tree does not count: an open made while the user is typing there
is one they started, such as creating a file. Every open the user starts,
creating a file with or without a tab open included, SHALL focus the editor.

#### Scenario: A late editor mount leaves the new-file field focused

- **WHEN** the editor mounts late and, before it does, the user clicks "New
  file" and types a name
- **THEN** once the editor shows the file, the new-file field still has
  focus and holds the name

#### Scenario: A workspace re-open leaves the composer focused

- **WHEN** the user is typing in the assistant's composer and the workspace
  is re-opened without them asking (another tab of the browser creates a
  file in the same project)
- **THEN** once the editor shows the file again, the composer still has
  focus and holds what was typed, and the editor does not have focus

#### Scenario: Opening a file with no tabs focuses the editor

- **WHEN** a user closes every tab and clicks `lib.rs` in the files column
- **THEN** the editor opens `lib.rs` and has focus

#### Scenario: Creating a file with a tab open focuses the editor

- **WHEN** a tab is open and the user clicks "New file", types `x.rs` and
  presses Enter
- **THEN** the editor opens `x.rs` and has focus

#### Scenario: Creating a file with no tabs focuses the editor

- **WHEN** a user closes every tab, clicks "New file", types `y.rs` and
  presses Enter
- **THEN** the editor opens `y.rs` and has focus

### Requirement: Four columns and no header

From 1024 px wide the product SHALL show, left to right, the navigation, the
assistant, the files column, and the stage over the console, with the stage
bar (`flow-stage-tab-*`: Write, Build, Deploy, Interact) across the files
column and the stage. There SHALL be no top header: the project list
SHALL be in the navigation and the session footer, a cluster row and an
account row, at its foot. Between 768 and 1023 px the navigation SHALL start
as a rail on every load and the
assistant a Sheet opened by "Expand assistant". The rail's footer SHALL hold
the cluster's dot, coloured by whether the cluster answers and named "Cluster:
<name>", which opens the settings on the cluster, and an "Account" button,
which opens the account menu beside the rail. There SHALL be no left Sheet:
from 768 px the navigation is a column or a rail and the files column stays
beside the stage, and below it the phone's menu page holds the navigation
apart from the files.

#### Scenario: A wide window

- **WHEN** a user opens a project on a 1280 px wide window
- **THEN** the navigation, the assistant, the files column holding
  `#root-dir`, and the stage over the console sit side by side in that
  order, the stage tabs sit above the files column and the stage, and no
  header is shown

#### Scenario: Everything the header did

- **WHEN** a user on a 1280 px wide window switches the project, opens the
  settings and picks a stage by Ctrl+2
- **THEN** each works from its new place: the project list in the navigation,
  the settings from the navigation's footer, and the Build stage opens

#### Scenario: A tablet

- **WHEN** a user opens a project on an 834 px wide window
- **THEN** the navigation is a rail, the files column and the stage are
  shown, and "Expand assistant" opens the assistant in a Sheet

#### Scenario: The rail's footer

- **WHEN** a user on an 834 px wide window clicks the cluster's dot at the
  foot of the rail, clicks "Back to app", then clicks "Account"
- **THEN** the settings open with focus on the cluster, then close, and the
  account menu opens beside the rail

#### Scenario: A project started from the phone's menu

- **WHEN** a user at 393 or 740 px wide opens "Menu", picks New project and
  starts a project in the gallery
- **THEN** the project opens on Work, with the menu page out of view

#### Scenario: The navigation on a narrow window

- **WHEN** a user opens a project on a 740 px wide window and opens "Menu"
- **THEN** the navigation shows Home, New project, Tutorials, Programs, the
  project list and Get set up, and Tutorials opens its page

#### Scenario: Settings on a phone

- **WHEN** a user on a 390 px wide screen opens "Menu" and taps the cluster
  row
- **THEN** the settings open with focus on the cluster, and picking another
  cluster changes it

### Requirement: The frame is flush, with a bar over each column

From 768 px wide the product SHALL draw its columns edge to edge on one
background, separated by 1 px lines, with no inset and no gaps. Each column
SHALL start with a 44 px bar: the navigation's head, the assistant's head,
and over the files column and the stage a bar with "Collapse project panel"
/ "Expand project panel", the assistant's toggle and "Documentation". The
stage tabs SHALL sit in a full-width row under that bar. A hidden assistant
or files column SHALL take no width.

#### Scenario: The frame at 1440

- **WHEN** a user opens a project on a 1440 px wide window
- **THEN** the navigation starts at the window's left edge, every column
  bar is 44 px tall with its top at the window's top, and the four stage
  tabs together span the files column and the stage

#### Scenario: Hiding the assistant from the stage bar

- **WHEN** a user on a 1440 px wide window clicks "Hide the assistant" in
  the stage bar, then "Expand assistant"
- **THEN** the assistant takes no width and the project's name shows in the
  stage bar, then the assistant opens at the width it had

### Requirement: The session footer and account menu

The navigation's footer SHALL be two rows. The cluster row SHALL show the
cluster's dot and name, be named "Change cluster, currently <name>", and open
the settings on the cluster. The account row SHALL show the GitHub avatar (a
user icon when signed out), the login or "Sign in", and, with a wallet
connected, its shortened address and balance; it SHALL open the account
menu above it. The account menu SHALL hold, in order: "Sign in with GitHub"
when signed out (while signing in, "Signing in..." with "Cancel"), or when
signed in the profile's name, "Open GitHub profile" and "Sign out"; then
"Settings", "Docs" and the feedback entries; then the wallet, either "Connect
wallet" or its address and balance (opening the wallet window) and
"Disconnect wallet" ("Disconnect <name>" for an extension wallet, which hands
back to the Playground wallet). "Docs" SHALL open `https://solana.com/docs` in
a new tab.
"Sign out" SHALL ask "Sign out of GitHub?" in a dialog before it ends the
session. A failed sign-in SHALL show "Couldn't sign in" under the account
row, above the wallet's line when a wallet is connected, and its reason at the
head of the menu; a sign-in the user cancelled SHALL show nothing. ⌘, (Ctrl+, off macOS) SHALL open and close the settings anywhere in
the product. A cluster that does not answer SHALL turn the dot red, add
", down" to the cluster row's and the rail dot's names, and put a warning
first in the account menu that opens the settings on the cluster. The menu
SHALL have no "Proposal" group.

The footer SHALL send `session_account_menu_opened` with `from` (`footer` or
`rail`) each time the account menu opens, and `session_account_item_picked`
with `item` (`sign-in`, `cancel-sign-in`, `github-profile`, `sign-out`,
`settings`, `docs`, `cluster-down`, `connect-wallet`, `wallet`,
`disconnect-wallet`) each time a user picks one of its items; the feedback
entries are measured by `features/feedback`.

#### Scenario: Signing in from the account menu

- **WHEN** a signed-out user opens the account menu, picks "Sign in with
  GitHub", and the sign-in fails
- **THEN** the account row shows "Signing in..." with "Cancel" while it
  waits, then "Couldn't sign in" under "Sign in"

#### Scenario: Signing out asks first

- **WHEN** a signed-in user picks "Sign out" in the account menu, then
  "Cancel", then "Sign out" again and confirms
- **THEN** the session stays after "Cancel" and ends after the confirmation,
  and the account row shows "Sign in"

#### Scenario: Settings from the menu and by key

- **WHEN** a user picks "Settings" in the account menu, closes the settings,
  then presses ⌘, twice
- **THEN** the settings open, close, open and close again

#### Scenario: The wallet in the menu

- **WHEN** a user with no wallet connected picks "Connect wallet" in the
  account menu, then opens the menu again
- **THEN** the account row shows the wallet's shortened address and balance,
  and the menu offers "Disconnect wallet"

#### Scenario: A cluster that is down

- **WHEN** the cluster stops answering and the user opens the account menu
- **THEN** the cluster's dot is red, the cluster row is named "Change
  cluster, currently <name>, down", and the menu's first item opens the
  settings on the cluster

### Requirement: The Get set up checklist

From 768 px wide, and on a phone's menu page, the navigation SHALL show
"Get set up · <n> of 4" above the session footer, with four steps in order:
"Connect the assistant", "Choose a network", "Sign in with GitHub" and
"Connect a wallet". The first SHALL be done while a model is connected, the
second always (the default network counts as chosen), the third while
signed in, and the fourth while a wallet is connected. A done step SHALL show a tick and its
value (the cluster's name, the login, the wallet's shortened address); a
step to do SHALL run its action when clicked: open Connect a model, start
the GitHub sign-in, connect the wallet. The title SHALL fold the list, and
the user's last fold SHALL be kept on the device across a reload, one fold
for the device wherever it was made; until the user has folded or unfolded
it, a phone's menu page SHALL show it folded.
"Dismiss the checklist" SHALL hide it for good on the device, and so SHALL
all four steps being done at once. The rail SHALL show no checklist.

The checklist SHALL send `setup_item_picked` with `item` (`assistant`,
`github` or `wallet`) each time a user clicks a step to do,
`setup_dismissed` with `done` (how many steps were done) when it is
dismissed, and `setup_completed` the first time all four steps are done
together on the device.

#### Scenario: Counting the steps

- **WHEN** a signed-out user with a wallet connected and no model connected
  opens the product
- **THEN** the navigation shows "Get set up · 2 of 4", with "Choose a
  network" ticked and the cluster's name beside it, and "Connect a wallet"
  ticked and the wallet's shortened address beside it

#### Scenario: The default network counts

- **WHEN** a user opens the product for the first time on a device
- **THEN** the navigation shows "Get set up · 1 of 4", with "Choose a
  network" ticked and "devnet" beside it

#### Scenario: The fold survives a reload

- **WHEN** a user clicks "Get set up" to fold the checklist, then reloads
- **THEN** the checklist shows only its title, folded

#### Scenario: The checklist on a phone's menu page

- **WHEN** a user who has never folded the checklist opens a phone's menu
  page, unfolds the checklist there, then reloads and opens the menu again
- **THEN** the checklist shows only its title at first, and is unfolded
  after the reload

#### Scenario: A step opens its action

- **WHEN** a user clicks "Connect the assistant" in the checklist
- **THEN** Connect a model opens

#### Scenario: Dismissing the checklist

- **WHEN** a user clicks "Dismiss the checklist", then reloads
- **THEN** the checklist is gone, and stays gone after the reload

#### Scenario: Finishing the checklist

- **WHEN** the last of the four steps is done, and the user later opens the
  product in a new tab where no model is connected
- **THEN** the checklist is gone, and does not come back in the new tab

### Requirement: Settings are a page of their own

The settings SHALL open as a page that takes the whole window, in place of
the app, which SHALL stay loaded beneath it: the open file, the editor's
content and the terminal's session SHALL be as they were when the user comes
back. From 768 px wide the page SHALL show "Back to app" over a list of its
sections (Network, Project, Block Explorer, Build, Connection, Editor,
Notification, Server, Test UI, UI, Wallet, Experimental) beside the sections
themselves; a click on a section in the list SHALL bring that section into
view and mark it as current. Below 768 px the page SHALL show a bar with
"Back to app" and the title, and no list. Nothing of the app SHALL be drawn
over the page: a menu, popover or tooltip open when it opens SHALL close.
"Back to app", Escape and ⌘, (Ctrl+, off macOS) SHALL close it and give
focus back to the control that opened it, or, when that control is gone or
out of reach (on a phone page out of view), to another that opens the
settings, else to the control that opens the navigation. A page that never
opened the settings SHALL leave focus where the browser puts it. A setting that fails to render
SHALL leave the app as it was, with a notice and "Back to app" in place of
the page.

#### Scenario: A wide window's settings page

- **WHEN** a user on a 1280 px wide window opens the settings and clicks
  "Editor" in the section list
- **THEN** the page lists the twelve sections, the Editor section comes into
  view, and "Editor" is marked as current

#### Scenario: Nothing draws over the settings

- **WHEN** a user on a 1440 by 900 px window, in the dark theme and then in
  the light one, opens the settings
- **THEN** the stage tabs and the editor are not shown, and the page's
  heading is the topmost element where it is drawn

#### Scenario: Back to the app keeps the work

- **WHEN** a user with a file open in the editor opens the settings from the
  cluster row and clicks "Back to app"
- **THEN** the same file is open with the same content, and focus is back
  on the cluster row

#### Scenario: A menu open at ⌘, closes as the settings open

- **WHEN** a user opens the account menu and presses ⌘,
- **THEN** the settings page opens with focus on its heading and the menu
  is gone

#### Scenario: A tooltip open at ⌘, closes as the settings open

- **WHEN** a user on an 834 px wide window hovers the rail's cluster dot
  until its tooltip shows, and presses ⌘,
- **THEN** the settings page opens and the tooltip is gone

#### Scenario: Escape in a dialog opened from the settings closes only the dialog

- **WHEN** a user opens "From GitHub" on the settings page and presses
  Escape
- **THEN** the dialog closes and the settings page stays open
- **WHEN** the user opens it again and presses ⌘,
- **THEN** the settings page and the dialog both close

#### Scenario: A fresh load focuses no settings trigger

- **WHEN** a user loads the page at 1440 or 834 px wide and does nothing
- **THEN** no control that opens the settings has focus and no tooltip is
  open

#### Scenario: Closing the settings on a phone

- **WHEN** a user on a 390 px wide screen opens the settings from the menu
  page's cluster row and goes back to the app
- **THEN** Work shows, with focus on "Menu"

#### Scenario: The settings page on a phone

- **WHEN** a user on a 390 px wide screen opens the settings
- **THEN** a bar with "Back to app" and "Settings" heads the page, no
  section list is shown, and "Back to app" returns to the app

### Requirement: The settings page is measured

The product SHALL send `settings_opened` with where it was opened from
(`cluster`, `rail`, `menu` or `key`), `settings_closed` with how it was
closed (`back`, `escape` or `key`), and `settings_section_picked` with the
section, each time a user picks one in the section list.

#### Scenario: Opening and closing the settings is counted

- **WHEN** a user opens the settings by ⌘, and closes them with Escape
- **THEN** `settings_opened` is sent with `key` and `settings_closed` with
  `escape`

### Requirement: The navigation opens the gallery and the pages

While a page shows, Home in the navigation SHALL close it, and SHALL do
nothing else when Home is under the page. Otherwise Home SHALL NOT open the
gallery: it SHALL show Home, and leave Home in place while Home shows,
except over a shared project, which the project list cannot name: there it
SHALL go back to the work. New project SHALL open the gallery on its
default tab. Tutorials and Programs SHALL open the Tutorials and Programs
pages, and no gallery.

#### Scenario: Programs from the navigation

- **WHEN** a user clicks Programs in the navigation
- **THEN** the Programs page shows, with its search field and the program
  cards, Programs is marked current in the navigation, and no gallery opens

### Requirement: Tutorials and Programs are pages

The Tutorials and Programs pages SHALL take the place of the assistant and
the work, with the navigation beside them, under a column bar that names
the page. Each SHALL hold a search field that filters its cards by name and
description (a program's by its categories too) and a grid of cards, two
columns from 720 px and one below, each with an Open action. Opening a
tutorial SHALL open it in the work; opening a program SHALL import it as a
project and open it. A page SHALL close when one of its cards opens, when a
tutorial's route opens, when New project, Home or a project in the project
list is picked, when the product asks for the assistant over the work, and
on nothing else the user did; a project open before
the page SHALL come back as it was. The routes
`/tutorials` and `/programs` SHALL open their page.

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

### Requirement: The pages are measured

The pages SHALL send `catalog_shown` with `page` (`tutorials` or
`programs`) and `via` (`nav`, `home` or `link`) when a page shows;
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

New project SHALL open a dialog titled "What do you want to build?" that
holds Start from scratch (a framework, a project name and Start), then
Tutorials and Programs as one choice with a count each beside a search
field, then the chosen list's cards as the pages draw them. Opening it SHALL
close the left Sheet. Start SHALL make a project from the framework's
starter and close the dialog; opening a card SHALL open its tutorial or
import its program and close the dialog, and a failure SHALL stay on its
card. On a phone the dialog SHALL be a page of its own, and every card,
here and on the pages, SHALL be one target that ends in a chevron.

#### Scenario: Starting an Anchor project from New project

- **WHEN** a user opens New project from the navigation, keeps Anchor,
  names the project and presses Start
- **THEN** the dialog closes and the new project is the current one

#### Scenario: Opening a program from New project

- **WHEN** a user opens New project, picks Programs and opens a program
- **THEN** the dialog closes and the program opens as a project

#### Scenario: New project's controls line up and its list shows it scrolls

- **WHEN** a user opens New project at 1280 px
- **THEN** the framework chips, the name field and Start share one height
  and centre line, and a fade at the dialog's foot shows the list runs on

#### Scenario: New project on a phone is a page

- **WHEN** a user on a 390 px wide screen opens New project
- **THEN** the dialog fills the screen with no sideways scroll, and each
  card ends in a chevron

### Requirement: New project is measured

New project SHALL send `new_project_started` with `framework` when Start
makes a project, `new_project_start_failed` with `framework` when it fails,
and `catalog_tab_switched` with `tab` when the user picks the other list. A
failed Start SHALL be reported.

#### Scenario: Starting a project is measured

- **WHEN** a user picks Programs in New project, then Tutorials, then
  presses Start with Native picked
- **THEN** `catalog_tab_switched` is sent with `tab` `programs`, then
  `tutorials`, and `new_project_started` with `framework` `Native`

### Requirement: A start with no project opens on Home

A page load on `/` with no project SHALL show Home in place of the
assistant and the work, with the navigation beside it (on a phone, its menu
page), and SHALL NOT open the gallery. Home SHALL hold the question "Where
should we begin?" and a composer that opens the assistant. From 768 px it
SHALL hold three tiles, New project, Follow a tutorial and Open a program,
and four tutorial cards; New project SHALL unfold the start-from-scratch
row under the tiles, and the other two SHALL open the Tutorials and
Programs pages. Below 768 px it SHALL hold quick starts for a new Anchor
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
  tiles and four tutorial cards, no gallery opens, and no editor is mounted

#### Scenario: New project from Home

- **WHEN** a user on Home clicks New project, names the project and starts
  it
- **THEN** Home gives way to the work, with the new project's files in the
  files column and its default file in the editor

#### Scenario: A tutorial from Home

- **WHEN** a user on Home opens a tutorial card
- **THEN** the tutorial opens in the work, with its step in the stage

#### Scenario: Tiles that open a page

- **WHEN** a user on Home clicks Open a program
- **THEN** the Programs page shows in Home's place, and no gallery opens

#### Scenario: Home on a phone

- **WHEN** a user with no project opens `/` on a 390 px wide screen
- **THEN** the work page shows "Home" in its bar, the question, the quick
  starts for a new Anchor project and a beginner tutorial, the Browse row
  and the composer, and "New Anchor project" opens a new project on the code

#### Scenario: The composer on Home

- **WHEN** a user on Home on a 1280 px wide window clicks the composer
- **THEN** the assistant opens

### Requirement: Home is reachable from an open project

The navigation's Home item SHALL show Home while a project is open, and
deleting the last project on `/` SHALL show Home; so SHALL a navigation back
to `/` with no project open. A route other than `/` SHALL NOT show Home by
itself (a lesson's route goes to `/` on its own when its project is
deleted). The navigation's Home SHALL do nothing until the start is
decided, and a re-open of the project Home shows over (by sync) SHALL NOT
leave Home. The address SHALL NOT change when Home shows. While a
project is open the editor and the console SHALL stay mounted under Home,
so that going back to the project, by picking it in the navigation's list,
by the phone's Continue, or by opening another project and coming back,
SHALL find the same file, cursor, scroll position, undo history and console
output. Once no project is open on `/` the editor SHALL unmount, and the
next project SHALL open in a filled editor.

#### Scenario: Home from an open project and back

- **WHEN** a user with a project open types in the editor, clicks Home in
  the navigation, then picks the same project in the navigation's list
- **THEN** Home shows with the address unchanged, then the editor shows the
  same file with the cursor where it was, and undo removes the typing

#### Scenario: Home from an open project on a phone

- **WHEN** a user on a 390 px wide screen with a project open types in the
  editor, opens the menu, taps Home, then taps Continue
- **THEN** the menu gives way to Home on the work page, then the editor
  shows the typing

#### Scenario: Home after the last project is deleted

- **WHEN** a user deletes their only project
- **THEN** Home shows and no gallery opens, and New project from Home opens
  the new project's default file in the editor

### Requirement: Home is measured

Home SHALL send `home_shown` with `via` (`start`, `nav`, `last-deleted` or
`back`) when it shows; `home_left` with `via` (`current-project`,
`continue`, `open` or `nav`) when the work replaces it; `home_tile_opened` with `tile`
(`new-project`, `tutorials` or `programs`) when a user opens a tile;
`home_tutorial_opened` when a user opens a tutorial card;
`home_quickstart_opened` with `id` (`continue`, `new` or `tutorial`) when a
user picks a quick start on a phone; and `home_composer_opened` when a user
opens the assistant from its composer.

#### Scenario: Opening a tile

- **WHEN** a user on Home clicks Follow a tutorial
- **THEN** `home_tile_opened` is sent with `tile` `tutorials`

### Requirement: The navigation is measured

The navigation SHALL send `nav_item_opened` with `item` (`home`,
`new-project`, `tutorials` or `programs`) each time a user picks one of its
items.

#### Scenario: Picking Tutorials

- **WHEN** a user clicks Tutorials in the navigation
- **THEN** `nav_item_opened` is sent with `item` `tutorials`

### Requirement: The navigation lists the projects

From 768 px wide, and on a phone's menu page, the navigation SHALL list the
user's projects under "Projects", started lessons among them with the same
folder glyph and no step count (lesson-prototype-polish), pinned ones first,
with the open one marked. Each row's "Actions for <name>" SHALL
open a menu of Open (`O`), Pin or Unpin (`P`), Rename (`R`), Duplicate
(`D`), Export as zip (`E`) and Delete (`⌫`); while it is open, the letter,
or Backspace or Delete, SHALL run that item. A lesson's menu SHALL have no
Rename and no Duplicate. The rail SHALL show no project list. Pins SHALL be
kept on the device by workspace id, so a rename keeps them. A rename SHALL
happen in the row and reach the account the way the rename dialog's does. A
duplicate SHALL be a new project named "<name> copy" holding the files but
not the program keypair. An export whose conversion fails SHALL tell the
user and export the project as is.

#### Scenario: Pinning a project

- **WHEN** a user with projects "alpha" and "beta" picks Pin in the menu of
  "beta" and reloads
- **THEN** "beta" is listed first, with a pin, and its menu offers Unpin

#### Scenario: Renaming in place

- **WHEN** a user picks Rename in the menu of "alpha", types "gamma" and
  presses Enter
- **THEN** the row reads "gamma", its pin, if any, is kept, and a taken or
  invalid name instead keeps the field open and marked invalid

#### Scenario: A rename reaches the account

- **WHEN** a signed-in user renames a project that is not open from the list
- **THEN** the rename is announced with that project's id, so sync uploads
  the new name

#### Scenario: Duplicating a project

- **WHEN** a user picks Duplicate in the menu of "alpha"
- **THEN** "alpha copy" opens holding alpha's files, and no
  `.workspace/program-info.json` of alpha's

#### Scenario: Export with a failed conversion

- **WHEN** a user picks Export as zip, then "Convert and export", and the
  conversion fails
- **THEN** a toast says the layout could not be converted and the project
  downloads as is

#### Scenario: Deleting from the list

- **WHEN** a user picks Delete in the menu of a project that is not open and
  confirms
- **THEN** the project is gone from the list and the open project stays open

#### Scenario: Letter keys in a project's menu

- **WHEN** a user opens the menu of "alpha" and presses `D`
- **THEN** "alpha" is duplicated, as if Duplicate had been clicked

#### Scenario: The rail has no project list

- **WHEN** a user folds the navigation on a 1280 px wide window
- **THEN** no project row is shown, and unfolding it shows the list again

#### Scenario: A lesson's menu

- **WHEN** a user opens the menu of a started lesson
- **THEN** it offers Open, Pin, Export as zip and Delete, and neither Rename
  nor Duplicate

### Requirement: The project list is measured

The navigation SHALL send `nav_project_action` with the `action` (`open`,
`pin`, `unpin`, `rename`, `duplicate`, `export` or `delete`) and whether a
click or a key ran it each time a project action starts (`export` and
`delete` when their dialog opens), and `nav_project_action_failed` with the
`action` when the list's own part of it fails: an open, a pin, a rename, a
duplicate, or a dialog that does not open. A failure inside the export or
delete dialog is that dialog's to report.

#### Scenario: Pinning by key

- **WHEN** a user opens a project's menu and presses `P`
- **THEN** `nav_project_action` is sent with `action` `pin`, by key

### Requirement: One layout

The product SHALL offer one layout. The `?classic` URL parameter SHALL have
no effect.

#### Scenario: The classic parameter

- **WHEN** a user opens the product with `?classic` in the URL
- **THEN** the same layout appears as without it

### Requirement: The layout is measured

The product SHALL send `layout_viewport` with the `viewport` class (`wide`,
`compact` or `phone`) once per page load; `layout_panel_toggled` with the
panel (`nav`, `files`, `assistant` or `console`; the files column's earlier
name, `left`, is not sent), whether it is open, and whether a button, a key, a
drag of the panel's edge or the product itself did it (the product opens the
console on a deploy and the assistant on "Fix with assistant", and closes the
phone's Files sheet when a modal opens, since the sheet would keep focus from
it);
`layout_page_shown` with the page (`menu`, `work` or `preview`) and whether
a swipe, a button, a key or the product moved it, each time a phone page comes
into view after the load (crossing into the phone width with the stage off
Write is the product bringing the preview into view: one `auto` event); `layout_work_view` with the view (`chat` or `code`) and
whether a button, a key or the product switched it; `layout_assistant_widened` with whether the
assistant is now `wide`, each time Widen or Narrow is clicked; and `layout_restore_failed` with the
reason when a saved layout cannot be read.

#### Scenario: Toggling the assistant by key

- **WHEN** a user presses Ctrl+R with the assistant open
- **THEN** `layout_panel_toggled` is sent with the assistant, closed, by key

#### Scenario: Opening the preview on a phone

- **WHEN** a user on a 390 px wide screen taps "Preview the build"
- **THEN** `layout_page_shown` is sent with the page `preview`, by button

#### Scenario: Swiping between pages on a phone

- **WHEN** a user on a 390 px wide screen swipes from the code to the preview
- **THEN** the Build stage shows and `layout_page_shown` is sent once, with the page `preview`, by swipe

#### Scenario: Widening the assistant

- **WHEN** a user on a 1440 px wide window clicks "Widen the assistant"
- **THEN** `layout_assistant_widened` is sent with `wide: true`

#### Scenario: A corrupt saved layout is reported

- **WHEN** the saved layout is corrupt and the user loads the product
- **THEN** `layout_restore_failed` is sent with the reason `corrupt`
