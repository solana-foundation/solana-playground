/** Shared layout/color constants for the Flow canvas (panels, header). */

/** Gutter between the black page ground and each floating panel. */
export const GAP = "8px";

/**
 * Height of the bar pinned to a panel's bottom edge -- the console handle and
 * the left panel's new-file action. Shared so their top borders read as one
 * line across the canvas.
 */
export const BOTTOM_BAR_HEIGHT = "1.75rem";

/**
 * The product's gradient token, the same one `GradientButton` paints with
 * (logomark, stepper active dot, the one decisive CTA per view).
 */
export const GRADIENT = "var(--gradient-product)";
