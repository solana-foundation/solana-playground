import { useRef, useState } from "react";
import type { ComponentProps, ReactElement, Ref } from "react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

const OVERFLOW = "[data-overflow]";

/** Whether the text marked `data-overflow`, `trigger` or inside it, is cut short */
const isCut = (trigger: HTMLElement | null) => {
  const text = trigger?.matches(OVERFLOW)
    ? trigger
    : trigger?.querySelector<HTMLElement>(OVERFLOW);
  return !!text && text.scrollWidth > text.clientWidth;
};

/**
 * Shows `label` whole in a tooltip over `children`, the trigger, but only
 * while its `data-overflow` text is cut: a name that fits has nothing more to
 * say. Measured as the tooltip asks to open, so a resize in between is no
 * stale answer.
 *
 * The rest of the props and `ref` go to the trigger, so another trigger may
 * hold this one `asChild` (the model menu's does) and keep its own
 * `data-state` and handlers: the outer trigger's props win.
 */
export function OverflowTooltip({
  label,
  children,
  ref,
  ...trigger
}: {
  label: string;
  children: ReactElement;
  ref?: Ref<HTMLElement>;
} & Omit<
  ComponentProps<typeof TooltipTrigger>,
  "asChild" | "children" | "ref"
>) {
  const [open, setOpen] = useState(false);
  const element = useRef<HTMLElement | null>(null);
  const setElement = (node: HTMLElement | null) => {
    element.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };
  return (
    <Tooltip
      open={open}
      onOpenChange={(next) => setOpen(next && isCut(element.current))}
    >
      <TooltipTrigger {...trigger} ref={setElement} asChild>
        {children}
      </TooltipTrigger>
      {/* A model id has no spaces to wrap at */}
      <TooltipContent className="break-all">{label}</TooltipContent>
    </Tooltip>
  );
}
