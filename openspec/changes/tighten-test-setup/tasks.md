# Tasks

## 1. Tighten the client-v2 test setup (HOO-1914, one PR)

- [x] 1.1 Type the test API in test code only: add `tsconfig.app.json`, run it in `test-types`, point `"mocha"` at a local declaration through `tsconfig.json` `paths` (`@types/mocha` stays for the editor), add an `it.each` test, and correct the comments and the `AGENTS.md` rule that blamed `@types/mocha`. Verify: the `it.each` test passes `yarn test-unit` and `yarn test-types`; a probe `vi.fn()` in a non-test file fails `yarn test-types`. Plan (all of 1.x): [plans/1.1-tighten-test-setup.md](plans/1.1-tighten-test-setup.md)
- [x] 1.2 Check `src/test-utils/mock-fs.ts` against `PgFs` (a `satisfies` helper) and fix the drift (`createDir`, `removeDir`, `convertToFullPath`, and what the check finds). Verify: `yarn test-types` passes, and fails when a probe changes a signature. Depends on 1.1 (the mock is in the test program).
- [x] 1.3 Delete the global `BroadcastChannel` in `src/setupTests.ts`; tests that need one install a fake. Verify: `yarn test-unit` passes with the same test names as the base.
- [x] 1.4 `views/flow/lessons/store.test.ts` "toasts once" imports `./SaveFailedToast` before asserting. Verify: the test passes in `yarn test-unit`.
- [x] 1.5 Drop the mock answers that restate what `mockReset` restores (`stage.test.ts`, `tab-sync.test.ts`, `project-sync.test.ts`, `tab-reload.test.ts`, `workspace-refresh.test.ts`; `deploy-history.test.ts` has none on this base), keeping the `valueOf -> null` constraint with a correct explanation. Verify: `yarn test-unit` passes with the same test names as the base.
