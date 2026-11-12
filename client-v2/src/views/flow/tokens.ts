/** Shared layout/color constants for the Flow canvas (panels, stage bar). */

/**
 * The sync banner slot's side and bottom padding (`Flow`'s `BannerSlot`); the
 * frame itself is flush (design.md, "Frame chrome (5.25)")
 */
export const GAP = "8px";

/**
 * Height of the bar pinned to a panel's bottom edge -- the console's bar and
 * the left panel's new-file action. Shared so their top borders read as one
 * line across the canvas.
 */
export const BOTTOM_BAR_PX = 28;
/**
 * In px, not rem: the layout shell folds the console's panel to exactly this
 * height (`PANEL_SIZES.console.folded`), and the panel library sizes in px.
 */
export const BOTTOM_BAR_HEIGHT = `${BOTTOM_BAR_PX}px`;

/**
 * The console's bar below 768 px: a finger's 44 px, not the wide 28
 * (`BaseConsoleDrawer`'s `max-md:h-11`). Every phone layout that folds the
 * console to its bar folds it to this height, or the bar's foot is cut off.
 */
export const PHONE_CONSOLE_BAR_PX = 44;

/**
 * The product's gradient token, the same one `BrandButton`'s ring paints with
 * (logomark, stepper active dot, the one decisive CTA per view).
 */
export const GRADIENT = "var(--gradient-product)";
