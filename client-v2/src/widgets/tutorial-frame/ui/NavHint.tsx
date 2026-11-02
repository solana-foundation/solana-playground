import { useEffect, useState } from "react";

import { readHintSeen, writeHintSeen } from "../model/storage";

export const NAV_HINT_TEXT = "The menu is folded to icons while you learn";

/** How long the hint stays, and how long it takes to fade */
const SHOW_MS = 6_000;
const FADE_MS = 120;

type Hint = "waiting" | "shown" | "leaving" | "gone";

interface NavHintProps {
  /** The navigation is on its rail in a tutorial */
  folded: boolean;
}

/**
 * The one-time line beside the folded mark (the prototype's `NavHint`): on
 * the first fold only, for 6 s or until a pointer down or a key. In the
 * tooltip's look, one line, and clicks go through it. The prototype's line
 * carries no ⌘B, so neither does this one.
 */
const NavHint = ({ folded }: NavHintProps) => {
  const [hint, setHint] = useState<Hint>("waiting");

  useEffect(() => {
    if (hint === "waiting" && folded && !readHintSeen()) {
      writeHintSeen();
      setHint("shown");
    }
    // Opened while it shows: it has done its job
    if (hint === "shown" && !folded) setHint("gone");
  }, [folded, hint]);

  useEffect(() => {
    if (hint !== "shown") return;
    const leave = () => setHint("leaving");
    const timer = window.setTimeout(leave, SHOW_MS);
    window.addEventListener("pointerdown", leave, { capture: true });
    window.addEventListener("keydown", leave, { capture: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", leave, { capture: true });
      window.removeEventListener("keydown", leave, { capture: true });
    };
  }, [hint]);

  useEffect(() => {
    if (hint !== "leaving") return;
    const timer = window.setTimeout(() => setHint("gone"), FADE_MS);
    return () => window.clearTimeout(timer);
  }, [hint]);

  if (hint !== "shown" && hint !== "leaving") return null;
  return (
    <div
      role="status"
      data-leaving={hint === "leaving" || undefined}
      className="pointer-events-none absolute top-[7px] left-[3.75rem] z-50 flex h-[1.875rem] items-center rounded-md border border-border bg-popover px-3 text-xs whitespace-nowrap text-muted-foreground shadow-md transition-opacity duration-[120ms] data-[leaving]:opacity-0 motion-reduce:transition-none"
    >
      {NAV_HINT_TEXT}
    </div>
  );
};

export default NavHint;
