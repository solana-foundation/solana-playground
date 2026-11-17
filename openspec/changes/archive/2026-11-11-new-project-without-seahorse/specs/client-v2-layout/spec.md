## ADDED Requirements

### Requirement: A new project starts from Anchor or Native

Start from scratch's "Framework" row SHALL offer Anchor and Native, in that
order, with Anchor chosen when the page opens, and SHALL NOT offer Seahorse,
which is deprecated upstream. The Home page's New project tile SHALL read
"Anchor or Native". Seahorse projects that already exist, and the Seahorse
tutorials, SHALL open and build as before.

#### Scenario: Start from scratch without Seahorse (manual)

- **WHEN** a user opens New project
- **THEN** Start from scratch's Framework row shows Anchor and Native, Anchor
  chosen, and no Seahorse
- **AND** the Home page's New project tile reads "Anchor or Native"
