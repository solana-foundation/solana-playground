import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

import {
  Composer,
  ComposerChip,
  ComposerContextList,
  ComposerInput,
  ComposerSend,
  ComposerToolbar,
} from "@/shared/ui/composer";
import { LogoMark } from "@/shared/ui/logo";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

/** One thing the assistant reads each turn, named in the composer */
export interface ComposerContextChip {
  label: string;
  /** What exactly is sent, for the tooltip */
  title: string;
}

/**
 * Where the user writes to the assistant: what it will read, the words, the
 * model and effort, and Send, which turns to Stop while a turn runs.
 *
 * The input stays editable during a turn; the design system's `Composer`
 * refuses to submit while `busy`, so typing ahead cannot start a second turn.
 * `ComposerAdd` is left out until there is something to add.
 */
export function BaseAssistantComposer({
  chips,
  value,
  onValueChange,
  onSend,
  onStop,
  busy,
  placeholder,
  model,
  effort,
  focusRequest = 0,
}: {
  chips: ComposerContextChip[];
  value: string;
  onValueChange(value: string): void;
  onSend(text: string): void;
  onStop(): void;
  busy: boolean;
  placeholder: string;
  /** The model menu, or the button that opens Connect a model */
  model: ReactNode;
  /** The effort menu, or nothing for a backend without one */
  effort: ReactNode;
  /** Focuses the input whenever it changes; `0` never does, so mounting does not steal focus */
  focusRequest?: number;
}) {
  // On the form: the installed `ComposerInput` keeps its own ref for sizing,
  // and a `ref` passed to it would replace that one
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (focusRequest === 0) return;
    form.current?.querySelector("textarea")?.focus();
  }, [focusRequest]);

  return (
    <div className="flex flex-col gap-1.5">
      <Composer
        ref={form}
        busy={busy}
        onStop={onStop}
        onSubmit={() => onSend(value)}
      >
        {chips.length > 0 && (
          <ComposerContextList>
            {chips.map((chip) => (
              <Tooltip key={chip.label}>
                {/* Focusable, so the explanation reaches keyboard users too */}
                <TooltipTrigger asChild>
                  <ComposerChip tabIndex={0}>{chip.label}</ComposerChip>
                </TooltipTrigger>
                <TooltipContent className="max-w-80 break-all whitespace-pre-wrap">
                  {chip.title}
                </TooltipContent>
              </Tooltip>
            ))}
          </ComposerContextList>
        )}
        <ComposerInput
          aria-label="Message the assistant"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onValueChange(e.target.value)}
        />
        <ComposerToolbar>
          {model}
          {effort}
          <ComposerSend>
            <LogoMark className="size-4" />
          </ComposerSend>
        </ComposerToolbar>
      </Composer>
      <p className="px-1 text-center text-xs text-muted-foreground">
        Nothing is written to your project without your click
      </p>
    </div>
  );
}
