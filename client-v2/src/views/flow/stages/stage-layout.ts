/**
 * Where a Build, Deploy or Interact stage's action sits. The action row is the last
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
 * source lines and the deploy result's program id need the room. Below `md`
 * the words sit in the middle of what the action row leaves, as the
 * prototype's phone stage sets them; a report (`STAGE_REPORT`) starts at the
 * top.
 */
export const STAGE_BODY =
  "max-w-[42rem] max-md:min-h-full max-md:flex-1 max-md:pb-0 max-md:[&>:first-child]:mt-auto";

/** A stage that reports results rather than an empty state: read from the left, from the top */
export const STAGE_REPORT =
  "my-0 items-start text-left max-md:[&>:first-child]:mt-0";

/**
 * The action row, on `StageEmptyActions`: below `md` it is pushed to the
 * stage's foot, and its buttons are a fingertip tall (48 px) in the phone's
 * 16 px type, as the prototype's phone pill. Its fade is left to the part,
 * which starts it from `--background`, the colour the stage column shows
 * below `md`.
 */
export const STAGE_FOOT =
  "max-md:mt-auto max-md:[&_button]:h-12 max-md:[&_button]:text-base";
