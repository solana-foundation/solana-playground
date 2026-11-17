# Spec Delta

## ADDED Requirements

### Requirement: A doc page's headings carry their site's ids

Every heading of a doc page SHALL have an `id` equal to the slug the page's
own site gives that heading: the GitHub scheme, lower case, spaces to `-`,
punctuation other than `-` and `_` dropped, a repeated heading suffixed
`-1`, `-2`. The ids are read inside the page's own element (test id
`tutorial-doc-page`), never from the document.

#### Scenario: A heading with code in it
- **WHEN** Program Structure's `#[derive(Accounts)] macro` heading renders
- **THEN** its id is `deriveaccounts-macro`, the id the heading has on
  anchor-lang.com

### Requirement: A doc link's section opens the page at that heading

A link to one of the tutorial's doc pages with a section (`page#section`)
SHALL open the page's tab with that heading at the top of the page's scroll
area. The page SHALL open at its top when the link names no section, or a
section the page has no heading for; a page already in front SHALL stay
where it is for such a link. `tutorial_workspace_doc_opened` SHALL
carry `section`: the heading id the link named, or none; the event fires as
before, and not when the page is already in front.

#### Scenario: A section from the assistant's answer
- **WHEN** the assistant's answer links
  `https://www.anchor-lang.com/docs/basics/program-structure#account-validation`
  and the learner presses it
- **THEN** the Program Structure tab opens, read only, with the Account
  Validation heading at the top of the page's scroll area
- **AND** `tutorial_workspace_doc_opened` fires with `doc:
  program-structure.md`, `via: assistant`, `section: account-validation`

#### Scenario: A section the page lacks
- **WHEN** the assistant's answer links
  `https://www.anchor-lang.com/docs/basics/program-structure#no-such-section`
  and the learner presses it
- **THEN** the Program Structure tab opens at its top, and the event's
  `section` is `no-such-section`

#### Scenario: A second section of the open page
- **WHEN** Program Structure is in front at `#program-attribute` and the
  learner presses a link to its `#account-validation`
- **THEN** the page scrolls to Account Validation, and no event fires
