import type { Stage } from "@/views/flow/state/stage";

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

/**
 * The stage is one: Code shows it at `write`, the preview at any other. A
 * stage set from elsewhere (a key, a deploy, the stepper's Write tab) moves
 * the pager to the page that shows it, so no page is left without its stage.
 * The menu shows no stage, so `write` leaves it where it is.
 */
export const pageForStage = (
  stage: Stage,
  page: PhonePage
): PhonePage | null => {
  if (stagePageOf(stage) === "work") return page === "preview" ? "work" : null;
  return page === "preview" ? null : "preview";
};

/**
 * The stage a page sets when it comes into view. The menu shows no stage, so
 * it sets none; `lastPreview` is what the preview opens on from `write`.
 */
export const stageForPage = (
  page: PhonePage,
  stage: Stage,
  lastPreview: PreviewStage
): Stage | null => {
  if (page === "work") return stage === "write" ? null : "write";
  if (page === "preview") return stage === "write" ? lastPreview : null;
  return null;
};
