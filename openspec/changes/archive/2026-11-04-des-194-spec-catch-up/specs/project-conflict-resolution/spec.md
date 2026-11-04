## ADDED Requirements

### Requirement: The banner's answers sit under its question

The sync banner SHALL show its message first and its buttons ("Resolve…" when
offered, and the answers) in a row under it (`data-slot="callout-actions"`),
never beside it. Below 768 px the buttons SHALL each run the banner's width and
be 44 px tall. The outlined buttons take the page's text colour, not the
warning's.

#### Scenario: The banner on a phone

- **WHEN** a divergent conflict that names its files shows the banner on a
  390 px wide screen
- **THEN** "Resolve…", "Keep this version" and "Take the other version" sit
  under the message, one per row, each as wide as the banner
