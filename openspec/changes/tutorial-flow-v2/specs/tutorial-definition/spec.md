# Spec Delta

## Purpose

How a conversation tutorial is written down: one JSON definition per tutorial,
the schema that checks it, the loader that lists it in the catalog, and the
instruction an agent follows to write a new one.

## ADDED Requirements

### Requirement: A conversation tutorial is one JSON definition

A tutorial on the conversation flow SHALL be defined by one JSON file,
`client-v2/src/tutorials/<slug>/tutorial.json`, next to the tutorial's
starting files and thumbnail. The definition SHALL hold:

- the catalog metadata: name, description, authors, level (Beginner,
  Intermediate or Advanced), framework, languages, categories, thumbnail,
  minutes;
- the intro: the promise line, the log line the finished program prints,
  and the finished program shown before Start;
- the steps, from one to six. Each step has:
  - its title and its short label for the step bar;
  - its objective and what it teaches;
  - its main file;
  - the files' content at the step's start and at its target, and which
    files are read only;
  - its beats in order;
  - its goal;
  - its win, with the line it shows when the step passed from the Call panel,
    and no stat pills;
- the finish: headline, line, what was learned, its chips with their answers,
  and the next tutorial's slug;
- the docs: the short list of pages the tutorial needs, each with a title,
  the page's address on its own site, and a Markdown file under
  `client-v2/src/tutorials/<slug>/docs/`.

A definition SHALL hold no scripted answers matched from typed text; the live
assistant answers free messages (see `tutorial-conversation`).

A beat SHALL be one of:

- `say`: text, with an optional quote of a file line, lit or marked as an
  error;
- `write`: text and the block it writes into a file, or the file it creates;
- `ask`: a question with exactly three options, the index of the right one,
  one reason per wrong option, a hint, the block a right pick or a Skip writes,
  the key line that counts as typing it by hand, and whether the options are
  code or prose;
- `act`: build, deploy, build and deploy, run a client file, or call an
  instruction with arguments, with its title, context line and button label.

A step MAY carry the beats that follow a planned build failure (the
explanation, a fixing question and the second build), the assistant's line
inside the failed card, and `failsWith`: a line of the build log that marks
the planned failure, such as ``cannot find type `Hello` in this scope``. A
planned failure needs all three; `onFail` needs `planned`. A failed build is the planned one only
when its log contains `failsWith`, so a planned error with no code, like
Lumberjack's, is recognised too. Text fields SHALL accept the inline Markdown the
conversation renders: inline code, emphasis and links. A text MAY carry a
shorter phone variant.

#### Scenario: Hello Anchor as the proof

- **WHEN** `client-v2/src/tutorials/hello-anchor/tutorial.json` is loaded
- **THEN** it validates against the schema
- **AND** it describes four steps (Program, Deploy, Client, Name) with four
  questions and the planned E0412 failure in step 1, with the copy of
  Almaz's `SPEC.md` section 7 except where `tutorial-runs` replaces the Kora
  copy
- **AND** its docs list Anchor's Program Structure and IDL pages and
  Solana's Programs and Transactions pages

### Requirement: The schema names every error by its path

The definition SHALL be checked against a JSON Schema at
`client-v2/src/tutorials/tutorial.schema.json`. The repository SHALL offer one
command, `yarn tutorial:check [<slug>]`, that validates one or every
definition. It SHALL print each error as its JSON path, what was expected and
what was found, and exit non-zero on any error. Beyond the schema, the check
SHALL reject:

- an `ask` whose right index is outside 0 to 2;
- a wrong option with no reason;
- a step whose goal names an instruction that no step's target defines;
- a `write` or `ask` block that does not appear in its step's target;
- a `next` slug that names no tutorial;
- two beats sharing an id;
- a doc whose Markdown file is missing;
- a doc address or a Markdown link that is not `https`.

`yarn run check` SHALL run it.

#### Scenario: A missing reason

- **WHEN** a definition's second step has a question whose option 2 is wrong
  and has no reason
- **THEN** `yarn tutorial:check` prints
  `steps[1].beats[3].why[2]: a wrong option needs a reason, found null`
- **AND** it exits with code 1

#### Scenario: A block the target does not hold

- **WHEN** a question's block is not part of its step's target file
- **THEN** the check names the beat's path and the file, and exits with code 1

### Requirement: The loader lists a definition beside the other tutorials

The catalog SHALL list each valid definition beside upstream's tutorials, with
its thumbnail, description and the meta line "<level> · <framework>". The
minutes and the step count show on the intro card, not on the catalog card.
For a conversation tutorial this replaces `tutorials-gallery-stand`'s caption
"<framework> · by <first author>", and its Start here banner reads "Continue ·
Step n of m" where that change has "Page <n> of <m>". The card's progress SHALL read
"<passed> of <m>" beside the name while it is started, and show a check once
the finish card has shown. Opening a tutorial with a definition SHALL open the conversation. A
tutorial without one SHALL open upstream's pages, unchanged. A definition that
fails validation in a running app SHALL not be listed. It SHALL be reported
once through the logger with its slug and its first error, and SHALL emit
`tutorial_definition_rejected`.

#### Scenario: Hello Anchor half done

- **WHEN** the learner has passed two of Hello Anchor's four steps
- **THEN** its card reads "2 of 4"
- **AND** the Start here banner offers "Continue · Step 3 of 4"

#### Scenario: A broken definition in a build

- **WHEN** a definition fails validation at load
- **THEN** the catalog lists the other tutorials and not that one
- **AND** `tutorial_definition_rejected` fires with `tutorial` set to its slug
  and `errors` set to the count of errors

### Requirement: An agent can write a tutorial from the authoring instruction

The repository SHALL hold one authoring instruction,
`client-v2/src/tutorials/AUTHORING.md`, that an agent follows to turn a
conversation with a product person into a definition. It SHALL be
self-contained: together with `tutorial.schema.json` it is everything a person
uploads to any LLM to write a tutorial, with no access to the repository. A
tutorial SHALL be published by a pull request that adds its folder; there is no
admin panel and no upload service. It SHALL cover:

- the questions to settle first: audience, level, the program, the steps
  (one to six; four to six for a published tutorial) and what each teaches;
- the beat types with one example each, taken from Hello Anchor;
- the voice rules of the script: two to four sentences a message, one rich
  block at most, three options with a reason for each wrong one, a win per
  step;
- how to write the start and target files so every block lands;
- how to run `yarn tutorial:check` and read its errors;
- how to try the tutorial locally, and how to open the pull request that
  publishes it.

A definition written by following it, and passing the check, SHALL open and
run in the conversation with no code change.

#### Scenario: A new definition needs no code

- **WHEN** an agent adds `client-v2/src/tutorials/<slug>/tutorial.json` and
  its files by the instruction, and the check passes
- **THEN** `yarn dev` lists the tutorial under its level
- **AND** it runs from the intro to the finish card

### Requirement: Definition rejections are measured

The tutorial slice SHALL emit `tutorial_definition_rejected` when the loader
drops a definition. Its parameters:

- `tutorial`: the slug;
- `errors`: the number of errors, an integer from 1.

#### Scenario: Counting a rejection

- **WHEN** a definition with two schema errors is loaded
- **THEN** one `tutorial_definition_rejected` reaches the memory provider
  with `errors: 2`

## MODIFIED Requirements

### Requirement: An act can name its record line

An act beat MAY carry its record line, which the card SHALL read once its run
landed, before the time it took ("Created your map · 10 KB"), whenever the card
is drawn as a record. An act whose result card stands right under it is not
drawn, as `tutorial-conversation` says, and its record line goes unseen. Without
one the card SHALL read its default record.

#### Scenario: Zero Copy's create card

- **WHEN** the act `init_map` with record "Created your map · 10 KB" lands and
  another turn stands between it and its result
- **THEN** its record reads "Created your map · 10 KB" followed by its time
