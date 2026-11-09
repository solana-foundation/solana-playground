# Spec Delta

## Purpose

The addresses of the client outside its pages and the work: what each path
opens and how the app writes a link to one.
The page paths (`/home`, `/new`, `/tutorials`, `/programs`) and the work's
path are `client-v2-layout`'s ("Home, the pages and the work have their own
addresses").

## ADDED Requirements

### Requirement: A GitHub repository opens at /github/ and its GitHub path

`/github/<owner>/<repo>` SHALL open the repository's program, and
`/github/<owner>/<repo>/tree/<ref>/<folder>` the program in that folder at
that ref, as the import dialog's URL field would: GitHub's own path after
`/github/`, nothing re-encoded. The address SHALL stay in the address bar
while the program shows.

#### Scenario: A folder of the examples repository opens

- **WHEN** a user opens
  `/github/solana-foundation/program-examples/tree/main/basics/hello-solana/native/program`
- **THEN** the editor shows that program's `lib.rs`, and the address bar still
  reads that path

### Requirement: A /github/ path that opens nothing says why

A path under `/github/` that names no GitHub repository (fewer than two
segments after it) SHALL fall through to the not-found route. A folder with
no program code SHALL show the import's own refusal ("No program code found
…") in the stage, and a later address SHALL replace it.

#### Scenario: A folder with no program says so, then gets out of the way

- **WHEN** a user opens a `/github/…/tree/main/<folder>` that holds no program
  code, then opens an example from the import dialog
- **THEN** the stage says "No program code found" for the first, and the
  example's program shows with no trace of that message

### Requirement: The import dialog links the /github/ address

The GitHub import dialog's explainer SHALL show one example address of the
form `<origin>/github/<owner>/<repo>/tree/<ref>/<folder>`, as a link that
opens in a new tab, and SHALL say that repositories are viewed at `/github/`
followed by their GitHub path. An example's Open (`github-example` row,
button "Open") SHALL navigate to that example's `/github/` address. No link
the dialog writes SHALL carry a scheme inside its path.

#### Scenario: The import and build server dialogs offer the recorded links

- **WHEN** a user opens the GitHub import dialog and the build server tip
- **THEN** every link is one of the recorded GitHub URLs, the explainer's
  playground address among them once `<origin>/github/` is read back as
  `https://github.com/`

#### Scenario: An example's Open shows its program

- **WHEN** a user clicks Open on the Hello Solana example
- **THEN** the address becomes that example's `/github/` path and the editor
  shows its `lib.rs`
