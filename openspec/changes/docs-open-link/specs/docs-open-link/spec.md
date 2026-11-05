## ADDED Requirements

### Requirement: A docs link carries one file in its fragment

Playground SHALL open `/open#<params>`, where `<params>` is URL-encoded
`key=value` pairs:

- `v`: the format version, `1`; required.
- `code`: the file's UTF-8 text, deflated (raw DEFLATE, RFC 1951) and
  base64url-encoded without padding; required.
- `name`: the file's name, letters, digits, `.`, `_` or `-`, ending in `.ts`
  or `.js`; required.
- `title`: shown as the project's title; optional, `name` without its
  extension by default.
- `from`: the `https:` page the link came from; optional.
- `sol`: a minimum devnet balance in SOL that the script needs, a positive
  decimal; optional.

The file SHALL open as an unsaved client project holding `client/<name>`,
with that file open in the editor. The project SHALL be unsaved, as a gist
opened from a link is. The data SHALL travel only in the fragment, so no
server sees the code.

#### Scenario: The Quickstart link
- **WHEN** the user opens `/open#v=1&name=quickstart.ts&title=Quickstart&from=https%3A%2F%2Fsolana.com%2Fdocs%2Fquickstart&sol=0.02&code=<deflated script>`
- **THEN** an unsaved project opens holding only `client/quickstart.ts`
  with the script's text, `quickstart.ts` is the open tab, and the stage
  row shows Write, the "Client project" label and Run

#### Scenario: No title
- **WHEN** a link has `name=hello.ts` and no `title`
- **THEN** the callout reads "From a docs link: hello"

#### Scenario: Gist and GitHub links (manual)
- **WHEN** the user opens `/gist/<id>` or `/<github url>`
- **THEN** it opens as before this change

### Requirement: A link that does not decode is reported as broken

Playground SHALL show "This link is broken" (`docs-link-broken`), and open no
project, when the fragment:

- lacks `v`, `code` or `name`;
- has a `v` other than `1`;
- has a `code` that is neither base64url nor base64, or does not inflate;
- has a `code` that inflates to empty text or to more than 100 KiB;
- has a `name` that breaks the rule above;
- has a `sol` that is not a positive number.

A `+` left unescaped in `code` SHALL read as `+`. Inflating SHALL stop as
soon as the output passes 100 KiB, so a small crafted stream cannot exhaust
memory.

The page SHALL say "Playground couldn't read the code in this link. It may
have been cut off when it was copied. Open the page in the docs again and use
its Open in Playground button." It SHALL offer two actions:

- "Back to the docs" (`docs-link-back`) SHALL go, in this order of preference,
  to the link's `from` when it reads as an `https:` URL, to
  `document.referrer` when that is a `solana.com` page, and otherwise to
  `https://solana.com/docs`.
- "Go to Home" (`docs-link-home`) SHALL go to `/`.

#### Scenario: A truncated link
- **WHEN** the user opens a Quickstart link with the last 40 characters of
  `code` cut off
- **THEN** "This link is broken" shows, no project opens, and "Back to the
  docs" goes to the link's `from`

#### Scenario: A link with no source and no referrer
- **WHEN** the user opens `/open#v=1&name=a.ts` with no `code`, typed into
  the address bar
- **THEN** "This link is broken" shows, and "Back to the docs" goes to
  `https://solana.com/docs`

### Requirement: Opening a docs link is measured

The `docs-link` slice SHALL send:

- `docs_link_opened` when a link decodes and its project opens. Its `host`
  is the host of `from`, or `none`; `bytes` is the decoded file's size.
- `docs_link_failed` when "This link is broken" shows. Its `reason` is one
  of `missing`, `version`, `decode`, `size`, `name` or `sol`.

#### Scenario: An event per open (manual)
- **WHEN** the user opens the Quickstart link, then a truncated one
- **THEN** `docs_link_opened` is sent with `host: "solana.com"`, then
  `docs_link_failed` with `reason: "decode"`
