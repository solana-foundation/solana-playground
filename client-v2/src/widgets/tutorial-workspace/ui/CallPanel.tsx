import { Send } from "lucide-react";
import type { FC } from "react";

import { PgCallPanel, PgConversation } from "@/features/tutorial-conversation";
import { useRenderOnChange } from "@/hooks";
import { COARSE_HIT } from "@/shared/lib/hit-area";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";

import BaseCallPanel from "./BaseCallPanel";

/** Re-render on the panel's own changes and on the engine's */
const useCallPanel = () => {
  useRenderOnChange(PgCallPanel.onDidChange);
  useRenderOnChange(PgConversation.onDidChange);
};

/** The panel over the editor while it is open */
export const CallPanel: FC = () => {
  useCallPanel();
  // eslint-disable-next-line unicorn/no-null -- React.FC takes null, not undefined
  if (!PgCallPanel.isOpen) return null;
  return (
    <BaseCallPanel
      view={PgCallPanel.view}
      tab={PgCallPanel.tab}
      onTab={PgCallPanel.setTab}
      onPick={PgCallPanel.pick}
      onType={PgCallPanel.type}
      onCall={() => void PgCallPanel.call()}
    />
  );
};

/** The head's Call button, once the program is deployed */
export const CallButton: FC = () => {
  useCallPanel();
  // eslint-disable-next-line unicorn/no-null -- React.FC takes null, not undefined
  if (!PgCallPanel.callable) return null;
  const open = PgCallPanel.isOpen;
  return (
    <>
      <Button
        variant="ghost"
        aria-pressed={open}
        onClick={PgCallPanel.toggle}
        className={cn(
          COARSE_HIT,
          "rounded-lg text-[0.8125rem] text-muted-foreground hover:text-foreground [&_svg]:size-4! [&_svg]:stroke-[1.5]",
          open && "bg-surface-hover text-foreground"
        )}
      >
        <Send aria-hidden="true" />
        Call
        {PgCallPanel.dot && (
          <span
            data-testid="tutorial-call-dot"
            aria-hidden="true"
            className="size-1.5 shrink-0 animate-pulse-dot rounded-full bg-brand-purple [animation-iteration-count:2]"
          />
        )}
      </Button>
      <span aria-hidden="true" className="mx-1 h-5 w-px bg-border" />
    </>
  );
};
