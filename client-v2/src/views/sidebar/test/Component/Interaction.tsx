import { FC } from "react";

import {
  Collapsible,
  CollapsibleChevron,
  CollapsibleContent,
  CollapsibleHeading,
} from "@/shared/ui/collapsible";

interface InteractionProps {
  name: string;
  /** What the card holds, quiet beside the name: "1 arg · 1 account" */
  meta?: string;
  /** Held open from outside; left out, the card folds on its own */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * One instruction, account or event: a card that folds open. The name is
 * the only heading; what opens under it sits below a hairline, so the card
 * reads as a head and a body, not as nested folds.
 */
const Interaction: FC<React.PropsWithChildren<InteractionProps>> = ({
  name,
  meta,
  open,
  onOpenChange,
  children,
}) => (
  <div className="rounded-xl border border-border bg-surface-panel">
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <CollapsibleHeading className="min-h-12 w-full gap-2 px-4 py-3 font-mono text-control font-medium">
        <CollapsibleChevron />
        {/* A long name wraps inside the card instead of running past it */}
        <span className="min-w-0 flex-1 text-left [overflow-wrap:anywhere]">
          {name}
        </span>
        {meta && (
          <span className="font-sans text-caption font-normal text-muted-foreground">
            {meta}
          </span>
        )}
      </CollapsibleHeading>
      <CollapsibleContent className="border-t border-border px-4 pt-4 pb-4">
        {children}
      </CollapsibleContent>
    </Collapsible>
  </div>
);

export default Interaction;
