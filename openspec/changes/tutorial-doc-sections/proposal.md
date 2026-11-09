# Proposal

## Why

The tutorial assistant links a doc page when its answer draws on one, but the
link opens the page at its top, and the learner has to find the section
themselves. Asked on 5 Nov "show me the account type code block in the docs",
the default model linked Program Structure at its top (HOO-2637). The pages
have no heading ids, a link's section is dropped when the page opens, and the
assistant's context names each page by title and address only, so it cannot
link a section even when it knows one.

## What Changes

- A doc page's headings get ids with the slugs their own sites use (the
  GitHub scheme: `#[derive(Accounts)] macro` is `deriveaccounts-macro`), so
  an address the assistant writes works on the tutorial's copy and on the
  original.
- The assistant's tutorial context lists, for each doc page, its sections
  with their addresses (`page#section`), and asks for the section that covers
  the answer when one does, the page otherwise.
- A link to `page#section` opens the page's tab scrolled to that heading. A
  section the page lacks opens the page at its top. A link to the page alone
  opens it at the top, as today.
- Telemetry: `tutorial_workspace_doc_opened` (widget `tutorial-workspace`)
  gains `section`, the heading id the link named, or none. No event is added,
  renamed or removed. No funnel step's code is touched.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `tutorial-workspace`: a doc link's section opens the page at that heading,
  and the headings carry their sites' ids. The capability's main spec does not
  exist yet: it is a delta of `tutorial-flow-v2`, which archives first.
- `tutorial-conversation`: the assistant's context lists each doc page's
  sections, and the assistant links the section that covers its answer.

## Impact

- `client-v2/src/components/Markdown` (heading ids on request),
  `client-v2/src/shared/lib/markdown-sections.ts` (a page's sections),
  `client-v2/src/entities/tutorial/model/docs.ts` (a link's section, the
  request a doc link makes),
  `client-v2/src/widgets/tutorial-workspace` (the page scrolls to the section;
  the event's `section`), `client-v2/src/widgets/tutorial-conversation`
  (the link handler, the context's docs line).
- Two new dependencies, `rehype-slug` and `github-slugger`, the same code
  the docs sites run for their heading ids. User-visible consequence: the
  tutorial's copy and the original answer the same section address.
- No server change, no definition schema change: sections are read from the
  pages' Markdown, so authors write nothing new.
- Out of scope: quoting a page's text in the answer; the phone's own layout
  of docs (HOO-2359). The phone shows the same page component, so a section
  link scrolls there too, but nothing phone-specific is built or tested here.
