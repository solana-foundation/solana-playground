# Design

## Context

See proposal.md, Why. The pieces as they are on `scope/tutorial-flow-2`:

- `components/Markdown` renders a doc page through `react-markdown` with
  `remark-gfm` only. Its `linkable` mode gives headings ids with the
  `toKebabFromTitle` slug under an `md` prefix and binds them to the router's
  hash; upstream's docs panel uses it. A doc page renders without it, so its
  headings have no id.
- `entities/tutorial/model/docs.ts`: `docForLink` matches a link to a page by
  host and path and drops the section on purpose; `requestDoc(file)` carries
  the file name alone to the workspace that listens.
- `widgets/tutorial-workspace`: `showDoc(file, via)` opens the tab, sends
  `tutorial_workspace_doc_opened`, and mounts `BaseDocPage` with
  `key={file}`, so each page opens at its top.
- `widgets/tutorial-conversation/model/context.ts` writes the docs line from
  `definition.docs` (title, address); `mode.ts` builds the facts from the
  conversation store and the explorer. The pages' Markdown lives on
  `TutorialData.docPages`, reached through `PgTutorial.all` (the workspace
  reads the route's `PgTutorial.current`), as the
  workspace already does.
- The docs sites (anchor-lang.com, checked 9 Nov; solana.com runs the same
  toolchain) give headings GitHub's slugs: `#[account(has_one = target)]` is
  `accounthas_one--target`. `toKebabFromTitle` collapses `--` to `-`, so it
  cannot reproduce them.

## Goals / Non-Goals

**Goals:**

- An address the assistant writes resolves to the same heading on the
  tutorial's copy and on the original.
- Sections come from the pages' Markdown; authors write nothing new.
- The same request path for a page and a section, so the phone and the
  desktop behave alike without phone work.

**Non-Goals:**

- Scrolling a file tab or the editor; only doc pages.
- Changing `linkable`, which upstream's docs panel depends on.
- Showing the sections in the tree or the Files sheet.

## Decisions

1. **`rehype-slug` for the ids, `github-slugger` for the context.**
   `rehype-slug` is `github-slugger` applied to a rendered heading's text
   with the same de-duplication the sites and GitHub use, so the copy's ids
   match the originals by construction. Alternative: extend
   `toKebabFromTitle`; rejected, it is upstream's slug for tutorial names and
   route paths, and changing it moves URLs. Alternative: write the scheme by
   hand; rejected, `github-slugger` is 40 lines around a large Unicode
   character class that is easy to get subtly wrong.
2. **Heading ids are opt-in on `Markdown` (`headingIds`), not default.**
   The feed's assistant answers and the other Markdown surfaces would
   otherwise gain ids that can collide across the document. `BaseDocPage`
   turns it on; the ids are plain slugs with no prefix, scoped by a
   query inside the page's own element, never `getElementById`.
3. **The context's sections are scanned from the Markdown source**, not
   rendered: ATX headings outside fenced code, below the title, with inline
   code, emphasis and link markup stripped, then `github-slugger` with one
   slugger per page for the `-1` suffixes. A unit test renders each real page
   through `rehype-slug` and asserts the scan gives the same ids, so the two
   cannot drift. Alternative: run `unified` in the context; rejected, the
   context is rebuilt on every assistant turn and the rendered tree is not
   needed.
4. **The link's section travels with the request.** `requestDoc` takes
   `{ file, section }`; the section is the link's fragment, decoded. The
   workspace keeps the requested section with the page it names and a
   counter, so a second press of the same link scrolls again and a page that
   mounts later never gets another page's section, and passes it to
   `BaseDocPage`, which sets its own scroll area's `scrollTop` to the
   heading's offset after mount and on each request. `scrollIntoView` is not
   used: it also scrolls ancestors, and the chat column beside the page must
   not move. A heading the page lacks leaves `scrollTop` alone and warns,
   since an assistant that invents sections shows there.
5. **The context reads the pages through a new fact, `docPages`.**
   `mode.ts` passes the pages of the tutorial the context names, not the
   route's current one, which differs while a navigation settles;
   `EngineContext` and the store are untouched. A page whose Markdown is
   missing is listed by title and address and warned about, since the
   assistant then links the page at its top as if it had no sections.
6. **`section` on the existing event**, not a new one: the question the data
   answers is how often a link names a section, which is one event's field.

## Risks / Trade-offs

- [The context grows: Zero Copy's Account Constraints page has about 25
  headings] → one line per page, sections separated by `, `. Section titles
  are short, and the docs line stays well under the step copy the context
  already carries.
- [The model invents a section] → the page opens at its top, which is
  today's behaviour, and the event records the section, so invented ones are
  countable.
- [A site changes its slug scheme] → the copy's ids are ours and the link
  still opens our page at the section; only the "Open on" original drifts.
- [A fixture page in `src/tutorials/__tests__/docs` differs from the real
  one] → the e2e runs on Hello Anchor's own pages, which the dev server
  serves whether or not `TUTORIAL_TEST_DOCS` is set.
