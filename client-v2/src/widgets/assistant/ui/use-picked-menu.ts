import { useRef, useState } from "react";

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
 * The items carry no letter shortcuts: a key that worked only while the menu
 * was open read as a global shortcut that did not work (HOO-2828).
 */
export const usePickedMenu = (focusPicked: () => boolean) => {
  const [open, setOpen] = useState(false);
  const picked = useRef(false);

  const pick = (action: () => void) => {
    picked.current = true;
    setOpen(false);
    action();
  };

  const onCloseAutoFocus = (event: Event) => {
    const wasPicked = picked.current;
    picked.current = false;
    if (wasPicked && focusPicked()) event.preventDefault();
  };

  return { open, setOpen, pick, onCloseAutoFocus };
};
