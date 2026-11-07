# client-v2-program-keypair Specification

## Purpose

The Deploy stage's controls over which program id a project deploys to: the
program keypair a first deploy needs, and a custom id that overrides it.

## Requirements

### Requirement: The Deploy stage has a folded Program id block

The Deploy stage SHALL show a fold labelled "Program id" (a section with
`aria-label="Program id"`) whose trigger button reads "Program id". Before
the first deploy it SHALL sit under the payer line; after a deploy, under
the history. It SHALL be closed by default and open by itself while a custom
id is set that does not match the keypair and the program is not known to
be deployed on the selected cluster.

Open, it SHALL show a text field with `aria-label="Program id"` holding the
project's program id (the custom id when one is set, else the keypair's
public key, else empty), a copy button labelled "Copy the program id", the
hint "Only the upgrade authority can upgrade the program.", the buttons
"New keypair" and "Export keypair", and a drop zone for importing a keypair
file (`aria-label="Import keypair"`, title "Drop a program keypair here",
description "or press to choose a .json file"), which also opens the file
picker when pressed. Every control in the block SHALL be quiet (outline or
ghost): the Deploy button stays the stage's only accent action.

#### Scenario: Closed until asked

- **WHEN** the Deploy stage opens for a project whose keypair matches its id
- **THEN** the "Program id" trigger shows and the field does not

#### Scenario: Open on a mismatch

- **WHEN** the project has a custom id that differs from its keypair's
  public key
- **THEN** the block is open and shows the mismatch warning

### Requirement: New keypair asks before replacing one

"New keypair" SHALL generate a keypair at once when the project has neither
a keypair nor a custom id. Otherwise it SHALL open a dialog titled "Create a
new program keypair?" (the legacy "Are you sure you want to…" title ran
under the dialog's close button) with the text "This will
create a brand new keypair for your program." (followed by "It also removes
the custom program id." while one is set), the warning "The old keypair will
be lost if you don't save it.", a "Save keypair" button that downloads the
current keypair (shown only when there is one), and a "Generate" button. "Generate" SHALL replace the keypair and remove any
custom id; closing the dialog SHALL change nothing.

#### Scenario: Replace a keypair

- **WHEN** the user presses "New keypair", then "Generate"
- **THEN** the field shows a new id, no custom id is set, and the dialog
  closes

#### Scenario: Cancel

- **WHEN** the user presses "New keypair", then closes the dialog
- **THEN** the keypair and the id are unchanged

### Requirement: Keypairs move as Solana CLI keypair files

"Export keypair" SHALL download `program-keypair.json`: a JSON array of the
keypair's 64 secret-key bytes, the format `solana-keygen` writes and
`solana program deploy --program-id` reads. It SHALL be hidden while the
project has no keypair or a custom id is set.

The "Import keypair" drop zone SHALL accept a `.json` file in that format,
dropped or picked, make it the project's keypair and remove any custom id.
When the project already has a keypair or a custom id, the import SHALL first
ask in a dialog titled "Replace the program keypair?", offering "Save keypair"
for the current keypair (shown only when there is one) and "Replace", which
applies the import; closing the dialog SHALL leave the keypair and the custom
id unchanged. A file that is not a JSON array of 64 numbers from 0 to 255
SHALL leave the keypair unchanged and show, under the drop zone, "That file is
not a program keypair: expected the 64-number JSON the Solana CLI writes."

#### Scenario: Round trip

- **WHEN** the user exports the keypair, replaces it with a new one and
  imports the exported file, answering "Replace"
- **THEN** the program id is the exported keypair's again

#### Scenario: Refused file

- **WHEN** the user imports a JSON file holding 32 numbers
- **THEN** the program id is unchanged and the refusal line shows

#### Scenario: An import over a keypair asks first (manual)

- **WHEN** the project has a keypair and the user drops another keypair file,
  then closes the dialog
- **THEN** the program id is unchanged

### Requirement: A custom id can be set and removed

Editing the field SHALL show a "Change program id" button. Pressing it
SHALL set the custom id when the text is a valid public key and say
"Program id changed" (left out while the mismatch warning shows, which it
would contradict); otherwise it SHALL leave the id unchanged and say "Not
a valid public key". While a custom id is set, a "Remove custom id" button
SHALL show; pressing it SHALL remove the custom id, so the keypair's id
applies again, and say "Custom id removed".

#### Scenario: Invalid text

- **WHEN** the user types "abc" and presses "Change program id"
- **THEN** the id is unchanged and "Not a valid public key" shows

### Requirement: A mismatched custom id is warned about before deploy

While a custom id is set, the project has a keypair whose public key
differs, and the program at the custom id is not known to be deployed on
the selected cluster, the block SHALL show a warning callout: "This program id does not
match the program keypair. A first deploy needs the keypair for this id:
import it, remove the custom id, or create a new keypair." A first deploy in
that state SHALL still refuse with the deploy command's existing message
("Entered program ID doesn't match the program ID derived from program's
keypair.").

#### Scenario: Deployed program, no warning (manual)

- **WHEN** the custom id names a program already deployed on the cluster
- **THEN** no mismatch warning shows, since an upgrade needs no keypair

#### Scenario: Warned and refused (manual)

- **WHEN** the user sets a custom id that differs from the keypair and
  presses Deploy on a cluster the program is not on
- **THEN** the warning shows and the deploy stops with the existing message

### Requirement: Program keypair events

The `features/program-keypair` slice SHALL emit, with prefix `keypair` and
no parameters unless named:

- `keypair_generated` when "New keypair" or "Generate" creates a keypair,
  with `replaced` (boolean: a keypair existed);
- `keypair_imported` when an import is accepted;
- `keypair_import_refused` when an import is refused, with `reason`
  (`not_json`, `wrong_shape`);
- `keypair_exported` when "Export keypair" or "Save keypair" downloads the
  file, with `from` (`block`, `dialog`);
- `keypair_custom_id_set` when "Change program id" sets an id;
- `keypair_custom_id_removed` when "Remove custom id" removes one.

No event SHALL carry a secret key, a public key or a program id.

#### Scenario: Events of a round trip (manual)

- **WHEN** the user exports, then imports a keypair
- **THEN** `keypair_exported` with `from: "block"` and `keypair_imported`
  are sent, and neither carries a key (asserted through the memory provider
  in the slice's React tests)
