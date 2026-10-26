import { createContext } from "react";

/**
 * Whether the keybinds of what sits under it are live. Off for UI that stays
 * mounted while off the page, so its keys do not act on what the user cannot
 * see (the work kept mounted under Home).
 */
export const KeybindsActive = createContext(true);
