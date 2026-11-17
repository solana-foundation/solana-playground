# Spec Delta

## ADDED Requirements

### Requirement: The assistant's context lists each doc page's sections

The tutorial context the assistant answers from SHALL list, for each doc
page, its title and address, then each heading below the title with its
address `page#id`, `id` being the heading's id on the page (see
`tutorial-workspace`). It SHALL ask for the covering section's address, the
page's when none covers, and the page's too when the answer names the page a
section is in; addresses exactly as listed, one page at most per answer.

#### Scenario: A question about one section
- **WHEN** in Hello Anchor the learner asks about the account types in
  Program Structure
- **THEN** the context the assistant reads lists Program Structure's
  sections, among them
  `#[account] attribute (https://www.anchor-lang.com/docs/basics/program-structure#account-attribute)`
- **AND** a page with no heading below its title is listed by title and
  address alone, as before
