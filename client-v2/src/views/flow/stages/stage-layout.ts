/**
 * Where a Build or Deploy stage's action sits. The action row is the last
 * element of the stage; below `md` the stage is at least as tall as its
 * frame and the row is pushed to the foot (`mt-auto`), where
 * `StageEmptyActions`' own `sticky bottom-0` keeps it when the content is
 * taller than the screen. The stage drops its own bottom padding there: the
 * row carries its own, and the thumb reaches the foot. On a desk the row
 * follows the content.
 */

/** The stage's scroll container: the stage router gives it the full height */
export const STAGE_FRAME = "flex h-full flex-col overflow-y-auto";

/**
 * The stage itself, on `StageEmpty`, wider than its own 36rem: a diagnostic's
 * source lines and the deploy result's program id need the room
 */
export const STAGE_BODY =
  "max-w-[42rem] max-md:min-h-full max-md:flex-1 max-md:pb-0";

/**
 * The action row, on `StageEmptyActions`. Its fade starts from the stage
 * column's own surface, `--surface-panel`, not the page's background, which
 * drew a darker band behind the button.
 */
export const STAGE_FOOT = "max-md:mt-auto max-md:from-surface-panel";
