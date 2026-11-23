# docs-open-link Specification

## Purpose

**Area:** the `/open` route and the callout above the code it opens
(client-v2 UI)

How a docs page's "Open in Playground" link opens one file in Playground, and
how much of what the link says Playground shows as fact: the source is only
the link's claim, and the SOL it may ask for is capped.

## Requirements

### Requirement: A link's source is shown as its claim

The callout above the code of a project a docs link opened SHALL present the
link's source as what the link says, never as a verified origin: the title
reads "Opened from a link: <title>", and the line under it names the host the
link gives as the link's claim and asks the user to read the code before
running it. Playground MUST NOT show "From <host>" for code it has not
verified.

#### Scenario: A crafted link with a solana.com source

- **WHEN** a link carries arbitrary code with `from=https://solana.com/docs/quickstart`
- **THEN** the callout's title is "Opened from a link: <title>"
- **AND** no text in it starts with "From solana.com"
- **AND** its line says the link says it comes from solana.com

#### Scenario: No title

- **WHEN** a link has no `from` and no `title`, with `name=hello.ts`
- **THEN** the callout reads "Opened from a link: hello", with no host named

### Requirement: A link asks for at most 1 SOL

A link's `sol` SHALL be at most 1. A larger value MUST break the link with
the reason `sol`, as any other invalid value does.

#### Scenario: Above the cap

- **WHEN** a link carries `sol=2`
- **THEN** "This link is broken" shows and `docs_link_failed` has reason `sol`

#### Scenario: The Quickstart link

- **WHEN** a link carries `sol=0.02`
- **THEN** it opens
