# Tasks

Plan: [plans/1-open-link-trust.md](plans/1-open-link-trust.md). All tasks
belong to HOO-2883 and land in one PR.

## 1. Link

- [ ] 1.1 Cap `sol` at 1 in `decodeDocsLink`; document it in
      `docs/open-in-playground-link.md` (HOO-2883)
- [ ] 1.2 The callout shows the source as the link's claim (HOO-2883)

## 2. Run

- [ ] 2.1 `PgClientRun` asks before the first Run of a link's project, and the
      `BaseRunConfirm` dialog shows the code (HOO-2883)
- [ ] 2.2 e2e: the Quickstart runs after one confirmation; a crafted link does
      not read as official; a link over the cap is broken (HOO-2883)
