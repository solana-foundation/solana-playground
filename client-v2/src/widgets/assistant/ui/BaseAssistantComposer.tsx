import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { XIcon } from "lucide-react";

import {
  Composer,
  ComposerAdd,
  ComposerChip,
  ComposerContextList,
  ComposerInput,
  ComposerSend,
  ComposerToolbar,
} from "@/shared/ui/composer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Button } from "@/shared/ui/button";
import { LogoPlay } from "@/shared/ui/logo";
import { MenuItemText } from "@/shared/ui/menu-extras";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import { usePickedMenu } from "./use-picked-menu";

/** One thing the assistant reads each turn, named in the composer */
export interface ComposerContextChip {
  label: string;
  /** What exactly is sent, for the tooltip */
  title: string;
  /** The chip's name for a screen reader: what goes with the message, in full */
  spoken: string;
  /** Leaves this item out of the next message; only the open file offers it */
  remove?: { label: string; run(): void };
}

// A phone's 44 px target around a chip drawn 22 px high, and around its
// remove button, without changing how either is drawn
const CHIP_TARGET =
  "relative before:absolute before:inset-x-0 before:-inset-y-[11px] before:content-[''] md:before:hidden";
const REMOVE_TARGET =
  "relative grid size-auto place-items-center rounded-full border-0 text-muted-foreground hover:bg-transparent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-transparent before:absolute before:-inset-x-1 before:-inset-y-3.5 before:content-[''] md:before:-inset-1";

/**
 * Where the user writes to the assistant: what it will read, the words, the
 * model and effort, and Send, which turns to Stop while a turn runs and is
 * disabled while nothing can take the message (`sendBlocked`).
 *
 * The input stays editable during a turn; the design system's `Composer`
 * refuses to submit while `busy`, so typing ahead cannot start a second turn.
 * The + (`ComposerAdd`) opens Sources and tools or Connect a model: the
 * same Sources and Connect entries as the head's More, with the same keys.
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
  sendBlocked = null,
  onSources,
  onConnect,
  connectLabel,
  focusPicked,
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
  /**
   * Why nothing can take a message now: Send's tooltip and the input's
   * description. Send is `aria-disabled` and Enter does nothing while it is
   * set, except during a turn, when Send is Stop. `null` leaves Send to the
   * design system, which disables it only while the input is empty.
   */
  sendBlocked?: string | null;
  /** Opens Sources and tools in place of the conversation */
  onSources(): void;
  /** Opens Connect a model */
  onConnect(): void;
  /** "Connect a model…" with nothing connected, "Connection and key…" once connected */
  connectLabel: string;
  /** Gives focus to what a pick from + opened; `false` when nothing took it */
  focusPicked(): boolean;
}) {
  // On the form: the installed `ComposerInput` keeps its own ref for sizing,
  // and a `ref` passed to it would replace that one
  const form = useRef<HTMLFormElement>(null);
  const reasonId = useId();
  // During a turn Send is Stop, which nothing blocks
  const blocked = busy ? null : sendBlocked;
  const add = usePickedMenu(focusPicked, { s: onSources, k: onConnect });
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
        onSubmit={() => {
          if (blocked === null) onSend(value);
        }}
      >
        {chips.length > 0 && (
          <ComposerContextList>
            {chips.map((chip) => (
              <Tooltip key={chip.label}>
                {/* Focusable, so the explanation reaches keyboard users too */}
                <TooltipTrigger asChild>
                  <ComposerChip tabIndex={0} className={CHIP_TARGET}>
                    {/* The short label is for the eye; a screen reader
                        reads what is sent, in full */}
                    <span aria-hidden="true">{chip.label}</span>
                    <span className="sr-only">{chip.spoken}</span>
                    {chip.remove && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={chip.remove.label}
                        className={REMOVE_TARGET}
                        onClick={() => {
                          chip.remove?.run();
                          // The button goes with its chip; the input next to
                          // it keeps the keyboard where the user was
                          form.current?.querySelector("textarea")?.focus();
                        }}
                      >
                        <XIcon aria-hidden="true" />
                      </Button>
                    )}
                  </ComposerChip>
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
          // Where the user is typing, a screen reader hears why Enter does nothing
          aria-describedby={blocked === null ? undefined : reasonId}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onValueChange(e.target.value)}
          onKeyDown={(e) => {
            // Escape stops a running turn, as Stop does; the draft stays
            // An Escape that ends an IME composition is the input method's
            if (e.key !== "Escape" || !busy || e.nativeEvent.isComposing) {
              return;
            }
            e.preventDefault();
            onStop();
          }}
        />
        <ComposerToolbar>
          <DropdownMenu open={add.open} onOpenChange={add.setOpen}>
            <DropdownMenuTrigger asChild>
              <ComposerAdd />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              side="top"
              className="w-auto min-w-48"
              onKeyDown={add.onKeyDown}
              onCloseAutoFocus={add.onCloseAutoFocus}
            >
              <DropdownMenuItem onSelect={() => add.pick(onSources)}>
                <MenuItemText>Sources and tools</MenuItemText>
                <DropdownMenuShortcut>S</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => add.pick(onConnect)}>
                <MenuItemText>{connectLabel}</MenuItemText>
                <DropdownMenuShortcut>K</DropdownMenuShortcut>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {model}
          {effort}
          {blocked === null ? (
            <ComposerSend>
              <LogoPlay className="size-4" />
            </ComposerSend>
          ) : (
            <Tooltip>
              {/* `aria-disabled`, not `disabled`: a disabled button takes no
                  focus and fires no pointer events, so its tooltip would
                  never open. The form's submit is refused above */}
              <TooltipTrigger asChild>
                <ComposerSend
                  aria-disabled="true"
                  className="aria-disabled:opacity-35"
                >
                  <LogoPlay className="size-4" />
                </ComposerSend>
              </TooltipTrigger>
              <TooltipContent>{blocked}</TooltipContent>
            </Tooltip>
          )}
        </ComposerToolbar>
        {blocked !== null && (
          <span id={reasonId} className="sr-only">
            {blocked}
          </span>
        )}
      </Composer>
      <p className="px-1 text-center text-xs text-muted-foreground">
        Nothing is written to your project without your click
      </p>
    </div>
  );
}
