/**
 * The phone's sheets, drawn one way (prototype `sheets/sheet.tsx`): the
 * panel's grey with rounder top corners and no rule round them, since on the
 * rounded top the kit's hairline read as an outline; a soft shadow lifts the
 * sheet off the page instead
 */
export const SHEET =
  "max-h-[82dvh] gap-0 rounded-t-2xl bg-surface-panel data-[side=bottom]:border-t-0 shadow-[0_-12px_40px_rgb(0_0_0/0.45)]";

/** The handle at the sheet's top, one you can see */
export const SHEET_HANDLE =
  "mx-auto mt-3 h-1 w-9 shrink-0 rounded-full bg-foreground/20";

/** A head whose title starts on the same 16 px edge as the rows under it */
export const SHEET_HEAD = "gap-1 px-4 pt-3 pb-2 text-left";
