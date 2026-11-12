## MODIFIED Requirements

### Requirement: Gist import is measured

The `features/gist` slice SHALL send, under the prefix `gist`:
`gist_import_started` when an import or a link starts reading a gist;
`gist_import_succeeded` when its files are read and laid out, before a
project is created or a view opened; `gist_import_failed`
when it stops. Each carries `from`: `dialog`, `link` or `new-project` (New
project's Import from GitHub card). `gist_import_succeeded`
carries `layout`: `manifest` or `loose`. `gist_import_failed` carries
`reason`: `not-found`, `rate-limited`, `too-large`, `invalid`, `no-program`
or `request-failed`.

#### Scenario: A failed import is counted with its reason

- **WHEN** an import from the dialog fails because the gist does not exist
- **THEN** `gist_import_failed` is sent with `from: dialog` and `reason: not-found`

#### Scenario: An import from New project is told apart (manual)

- **WHEN** a user imports a gist link from New project's Import from GitHub
  card
- **THEN** `gist_import_started` is sent with `from: new-project`
