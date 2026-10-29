import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";

/**
 * A menu whose items open something (Sources in place of the chat, Connect a
 * model over it), shared by the head's More and the composer's +.
 *
 * Once the menu has closed on a pick (after its exit animation), focus goes
 * to what the pick opened (`focusPicked`), not back to the trigger, which
 * would blur whatever the user reached in the meantime: a select opened in
 * that window shut. A dismissal (Escape, a click outside) still returns focus
 * to the trigger.
 *
 * `shortcuts` are single keys with no modifier, read here because the menu's
 * typeahead would take S but never K ("Connect…").
 */
export const usePickedMenu = (
  focusPicked: () => boolean,
  shortcuts: Record<string, () => void>
) => {
  const [open, setOpen] = useState(false);
  const picked = useRef(false);

  const pick = (action: () => void) => {
    picked.current = true;
    setOpen(false);
    action();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const action = shortcuts[event.key.toLowerCase()];
    if (!action) return;
    // Keeps the menu's own typeahead from also acting on the key
    event.preventDefault();
    pick(action);
  };

  const onCloseAutoFocus = (event: Event) => {
    const wasPicked = picked.current;
    picked.current = false;
    if (wasPicked && focusPicked()) event.preventDefault();
  };

  return { open, setOpen, pick, onKeyDown, onCloseAutoFocus };
};
