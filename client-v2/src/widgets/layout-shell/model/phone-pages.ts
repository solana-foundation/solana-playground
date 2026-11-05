import type { FlowState, Stage } from "@/views/flow/state/stage";

/** In the pager's DOM order, which is also its `scrollLeft` order */
export const PHONE_PAGES = ["menu", "work", "preview"] as const;
export type PhonePage = typeof PHONE_PAGES[number];
export const WORK_VIEWS = ["chat", "code"] as const;
export type WorkView = typeof WORK_VIEWS[number];
export const isWorkView = (value: string): value is WorkView =>
  (WORK_VIEWS as readonly string[]).includes(value);
export type PageSource = "swipe" | "button" | "key" | "auto";
export type WorkViewSource = "button" | "key" | "auto";
export type PreviewStage = Exclude<Stage, "write">;

/** The pages that show the stage: Code on Work, any other stage on Preview */
export type StagePage = Extract<PhonePage, "work" | "preview">;

/** The page that shows `stage`; the one rule `pageForStage` and the pager share */
export const stagePageOf = (stage: Stage): StagePage =>
  stage === "write" ? "work" : "preview";

/** What the pager reads of the flow: the stage, and whether a program has one */
export type PagerFlow = Pick<FlowState, "stage" | "hasProgram">;

/**
 * Whether the preview holds `write`: a project with no program has no other
 * stage, so its preview shows only the stage bar and the console, while the
 * stage itself stays on Code
 */
export const isPreviewAtWrite = (flow: Pick<FlowState, "hasProgram">) =>
  !flow.hasProgram;

/**
 * The stage is one: Code shows it at `write`, the preview at any other. A
 * stage set from elsewhere (a key, a deploy, the stepper's Write tab) moves
 * the pager to the page that shows it. The menu shows no stage, so `write`
 * leaves it where it is, and so does a preview that holds `write`
 * (`isPreviewAtWrite`).
 */
export const pageForStage = (
  flow: PagerFlow,
  page: PhonePage
): PhonePage | undefined => {
  if (stagePageOf(flow.stage) === "work") {
    return page === "preview" && !isPreviewAtWrite(flow) ? "work" : undefined;
  }
  return page === "preview" ? undefined : "preview";
};

/**
 * The stage a page sets when it comes into view. The menu shows no stage, so
 * it sets none; `lastPreview` is what the preview opens on from `write`,
 * unless the preview holds `write` (`isPreviewAtWrite`): a project with no
 * program does not offer that stage.
 */
export const stageForPage = (
  page: PhonePage,
  flow: PagerFlow,
  lastPreview: PreviewStage
): Stage | undefined => {
  if (page === "work") return flow.stage === "write" ? undefined : "write";
  if (page === "preview") {
    return flow.stage === "write" && !isPreviewAtWrite(flow)
      ? lastPreview
      : undefined;
  }
  return undefined;
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("widgets/layout-shell/model/phone-pages", () => {
    describe("pageForStage", () => {
      it.each([
        ["build", true, "work", "preview"],
        ["build", true, "menu", "preview"],
        ["build", true, "preview", undefined],
        ["write", true, "preview", "work"],
        ["write", true, "work", undefined],
        ["write", true, "menu", undefined],
        ["write", false, "preview", undefined],
        ["write", false, "work", undefined],
        ["write", false, "menu", undefined],
      ] as const)(
        "%s with a program %s, seen from %s, goes to %s",
        (stage, hasProgram, page, expected) => {
          expect(pageForStage({ stage, hasProgram }, page)).toBe(expected);
        }
      );
    });

    describe("stageForPage", () => {
      it.each([
        ["preview", "write", true, "deploy", "deploy"],
        ["preview", "interact", true, "build", undefined],
        ["preview", "write", false, "build", undefined],
        ["work", "build", true, "build", "write"],
        ["work", "write", true, "build", undefined],
        ["work", "write", false, "build", undefined],
        ["menu", "build", true, "build", undefined],
        ["menu", "write", true, "build", undefined],
      ] as const)(
        "%s seen at %s (a program: %s) with %s as the last preview sets %s",
        (page, stage, hasProgram, lastPreview, expected) => {
          expect(stageForPage(page, { stage, hasProgram }, lastPreview)).toBe(
            expected
          );
        }
      );
    });

    describe("stagePageOf", () => {
      it.each([
        ["write", "work"],
        ["build", "preview"],
        ["deploy", "preview"],
        ["interact", "preview"],
      ] as const)("%s shows on %s", (stage, expected) => {
        expect(stagePageOf(stage)).toBe(expected);
      });
    });

    describe("isWorkView", () => {
      it.each([
        ["chat", true],
        ["code", true],
        ["preview", false],
        ["", false],
      ])("%j is %s", (value, expected) => {
        expect(isWorkView(value)).toBe(expected);
      });
    });
  });
}
