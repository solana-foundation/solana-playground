/**
 * The width the four full labels need, in px. When the stage bar gives the
 * stepper less than this, the labels fold to their initials; the full name
 * stays in each tab's `aria-label`.
 *
 * Measured in Chromium at a 1280 px window, in Stack Sans: the list with no
 * stage marked is 304.1 px wide, border included. Its columns are equal, so
 * a check beside the widest label (18 px) widens all four, and a list with a
 * check on every stage needs 376.1 px, rounded up here. The constant covers
 * that case so a stage finishing never pushes the list past its bar; it is a
 * measurement, not derived, so re-measure when the labels, padding, font or
 * font size change.
 */
export const STEPPER_FULL_WIDTH_PX = 377;
