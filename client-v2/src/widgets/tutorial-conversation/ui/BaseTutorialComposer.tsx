import { ArrowUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { Placeholder } from "@/features/tutorial-conversation";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import {
  Composer,
  ComposerInput,
  ComposerSend,
  ComposerToolbar,
} from "@/shared/ui/composer";

export interface BaseTutorialComposerProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: Placeholder;
  /**
   * The live assistant answers: Send becomes Stop. Enter still routes the
   * message: a word runs, and a question waits in the box for the answer
   */
  busy: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  /** The finish chips' labels, after the finish; null during the lesson */
  chips: readonly string[] | null;
  /** A chip pressed, by its index */
  onChip: (index: number) => void;
  /**
   * Before Start: the box reads greyed until it takes focus, though it still
   * takes a question or a start word
   */
  waiting: boolean;
  /**
   * Given once the assistant has answered before Start, in words or with a
   * tool: the composer suggests starting, with the intro card's button
   */
  onStart?: () => void;
  /** A line over the box, such as why a question has not gone yet */
  note?: string | null;
}

/**
 * Whether a pointer is down anywhere on the page. A press elsewhere blurs
 * the field on its way down; folding then would move the button under the
 * pointer before its click lands
 */
const usePressing = () => {
  const pressing = useRef(false);
  useEffect(() => {
    const down = () => (pressing.current = true);
    const up = () => (pressing.current = false);
    window.addEventListener("pointerdown", down, { capture: true });
    window.addEventListener("pointerup", up, { capture: true });
    window.addEventListener("pointercancel", up, { capture: true });
    return () => {
      window.removeEventListener("pointerdown", down, { capture: true });
      window.removeEventListener("pointerup", up, { capture: true });
      window.removeEventListener("pointercancel", up, { capture: true });
    };
  }, []);
  return pressing;
};

/**
 * The chat column's one composer (spec "One composer; free questions go to
 * the live assistant"): never disabled, Enter sends, Shift+Enter breaks the
 * line, and ⌘↵ does nothing here, since in the column it presses the live
 * act. After the finish, the finish chips sit above it. Before Start it
 * reads greyed until focused, and once the assistant has answered, in
 * words or with a tool, it suggests starting, with "Start step 1"; both lift once the
 * lesson has begun (the designer's call, 3 Nov).
 *
 * The prototype's chat field (`f7d42bf2e`, design audit of 3 Nov): one line
 * at rest, 44 px (46 below `md`) with a 22 px line and Send beside the words, so the lesson
 * keeps the column; the full box once focused or holding text.
 */
const BaseTutorialComposer = ({
  value,
  onChange,
  placeholder,
  busy,
  onSend,
  onStop,
  chips,
  onChip,
  waiting,
  onStart,
  note,
}: BaseTutorialComposerProps) => {
  const [focused, setFocused] = useState(false);
  const pressing = usePressing();
  const open = focused || value !== "";
  return (
    <div className="flex flex-col gap-2">
      {onStart && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-caption text-subtle">Ready to start the lesson?</p>
          <Button size="sm" onClick={onStart}>
            Start step 1
          </Button>
        </div>
      )}
      {chips && (
        <div
          role="group"
          className="flex flex-wrap gap-2"
          aria-label="Ask next"
        >
          {chips.map((label, i) => (
            <Button
              key={label}
              variant="outline"
              size="sm"
              onClick={() => onChip(i)}
            >
              {label}
            </Button>
          ))}
        </div>
      )}
      {note && (
        <p role="status" className="text-caption text-subtle">
          {note}
        </p>
      )}
      <Composer
        busy={busy}
        onStop={onStop}
        onSubmit={() => onSend(value)}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          if (e.currentTarget.contains(e.relatedTarget)) return;
          const field = e.currentTarget.querySelector("textarea");
          const fold = () => {
            if (field === document.activeElement) return;
            setFocused(false);
            // The height it grew to while open would hold the one line open
            if (field && !field.value) field.style.height = "";
          };
          // Folding moves everything above the box, so it waits for a press
          // to end: the button under the pointer stays where it was pressed
          if (pressing.current) {
            window.addEventListener(
              "pointerup",
              () => requestAnimationFrame(fold),
              { once: true }
            );
          } else window.setTimeout(fold, 0);
        }}
        data-open={open || undefined}
        data-waiting={waiting || undefined}
        className={cn(
          !open && "flex-row items-center",
          waiting && "opacity-50 transition-opacity focus-within:opacity-100"
        )}
      >
        <ComposerInput
          // A 22 px line, not 15 × 1.5: 22.5 made the box half a pixel off.
          // A coarse pointer keeps its 16 px text, which stops iOS zooming in
          className={cn(
            "leading-[22px] placeholder:text-muted-foreground/80! max-md:max-h-[calc(4lh+1.25rem)] pointer-fine:max-md:text-[0.9375rem] pointer-fine:max-md:font-[350]",
            !open && "min-h-10 pt-2.5 pb-2.5 max-md:min-h-11"
          )}
          value={value}
          placeholder={placeholder}
          enterKeyHint="send"
          onChange={(e) => onChange(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) {
              return;
            }
            // The composer's Enter would send on ⌘↵ too
            if (e.metaKey || e.ctrlKey) {
              e.preventDefault();
              return;
            }
            // The composer holds every send while the assistant answers; a
            // live action's word still runs then, so Enter routes it here
            if (busy) {
              e.preventDefault();
              if (value.trim()) onSend(value);
            }
          }}
        />
        <ComposerToolbar className={cn(!open && "py-1 pr-1")}>
          {/* The prototype's Send: 32 px at every width, 44 px for a finger.
              The panel's composer keeps its own 48 px on a phone */}
          <ComposerSend className="max-md:size-8 max-md:data-[slot=composer-send]:[&_svg]:size-4 pointer-coarse:size-11 disabled:bg-surface-hover disabled:text-subtle disabled:opacity-100">
            <ArrowUp />
          </ComposerSend>
        </ComposerToolbar>
      </Composer>
    </div>
  );
};

export default BaseTutorialComposer;
