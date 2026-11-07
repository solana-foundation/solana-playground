/**
 * A 44 px hit area under a finger for a control drawn smaller, which looks
 * the same (DES-160, 3 Nov: the desktop layout from 1024 px, where a tablet's
 * touch reaches small controls). An invisible box centred on the control
 * takes the touch; with a mouse nothing changes.
 */
export const COARSE_HIT =
  "relative pointer-coarse:after:absolute pointer-coarse:after:top-1/2 pointer-coarse:after:left-1/2 pointer-coarse:after:size-11 pointer-coarse:after:-translate-x-1/2 pointer-coarse:after:-translate-y-1/2 pointer-coarse:after:content-['']";

/** The same, 44 px tall across the control's own width, for a wide, thin one */
export const COARSE_HIT_ROW =
  "relative pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:top-1/2 pointer-coarse:after:h-11 pointer-coarse:after:-translate-y-1/2 pointer-coarse:after:content-['']";

/**
 * A wide, thin control under another: its 44 px area starts at its own top
 * and reaches down, so it never covers the control above it
 */
export const COARSE_HIT_BELOW =
  "relative pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:top-0 pointer-coarse:after:h-11 pointer-coarse:after:content-['']";
