## MODIFIED Requirements

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
