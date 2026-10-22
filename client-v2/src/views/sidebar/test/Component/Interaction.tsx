import { FC } from "react";

import {
  Collapsible,
  CollapsibleChevron,
  CollapsibleContent,
  CollapsibleHeading,
} from "@/shared/ui/collapsible";

interface InteractionProps {
  name: string;
}

/** One instruction, account or event: a card that folds open */
const Interaction: FC<React.PropsWithChildren<InteractionProps>> = ({
  name,
  children,
}) => (
  <div className="rounded-xl border border-border bg-surface-panel p-4">
    <Collapsible>
      <CollapsibleHeading className="font-mono">
        <CollapsibleChevron />
        {name}
      </CollapsibleHeading>
      <CollapsibleContent className="mt-3">{children}</CollapsibleContent>
    </Collapsible>
  </div>
);

export default Interaction;
