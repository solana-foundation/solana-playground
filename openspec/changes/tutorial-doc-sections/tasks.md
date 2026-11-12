# Tasks

## 1. Doc sections (HOO-2637)

- [x] 1.1 Heading ids, the section's request, and the context's sections,
      in one PR. `rehype-slug` and `github-slugger` added; `Markdown` gets
      `headingIds`, which `BaseDocPage` turns on (test: a doc page's
      `#[derive(Accounts)] macro` heading has id `deriveaccounts-macro`);
      `docs.ts` gains `sectionOf` (a link's decoded fragment) and
      `requestDoc({ file, section })`, and `shared/lib/markdown-sections`
      `sectionsOf` (a page's headings with their ids, from the Markdown; in
      `shared`, since the conversation's context must not load the tutorial
      entity's barrel), with in-source tests that pin the ids
      anchor-lang.com gives (`declare_id-macro`, `deriveaccounts-macro`,
      `accounthas_one--target`) and a test that the scan equals
      `rehype-slug` on every real page under `src/tutorials/*/docs`. The
      workspace scrolls the page to the section, again on a repeated press,
      and `tutorial_workspace_doc_opened` carries `section`, asserted
      through the memory provider in `TutorialWorkspace.test.tsx`.
      `describeTutorial` takes `docPages` and writes each page's sections
      with `page#id` addresses and the instruction to link the section that
      covers the answer; `mode.ts` passes the `docPages` of the tutorial in
      `PgTutorial.all` whose name the context names; a
      page with no headings below its title, or no Markdown, is listed as
      before, covered by the in-source tests of `context.ts`. Verify: the
      three `tutorial-workspace` scenarios and the `tutorial-conversation`
      scenario (which reads the `/api/agent` request's context) run green
      as Playwright tests in `e2e/tutorial-workspace.e2e.spec.ts`, the unit
      tests pass, and `yarn run check` is green. (HOO-2637)

## Workflow follow-up

- Archive after `tutorial-flow-v2` archives, so `tutorial-workspace` has a
  main spec for this delta to merge into.
