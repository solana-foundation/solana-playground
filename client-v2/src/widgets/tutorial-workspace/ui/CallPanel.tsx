import { Send } from "lucide-react";
import type { FC } from "react";

import { PgCallPanel, PgConversation } from "@/features/tutorial-conversation";
import { useRenderOnChange } from "@/hooks";
import { COARSE_HIT } from "@/shared/lib/hit-area";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/shared/ui/sheet";

import type { BaseCallPanelProps } from "./BaseCallPanel";
import BaseCallPanel from "./BaseCallPanel";
import { SHEET, SHEET_HANDLE } from "./sheet-chrome";

/** Re-render on the panel's own changes and on the engine's */
const useCallPanel = () => {
  useRenderOnChange(PgCallPanel.onDidChange);
  useRenderOnChange(PgConversation.onDidChange);
};

/** The panel's props, from the panel's own state */
const panelProps = (): BaseCallPanelProps => ({
  view: PgCallPanel.view,
  tab: PgCallPanel.tab,
  onTab: PgCallPanel.setTab,
  onPick: PgCallPanel.pick,
  onType: PgCallPanel.type,
  onCall: () => void PgCallPanel.call(),
});

/** The panel over the editor while it is open */
export const CallPanel: FC = () => {
  useCallPanel();
  // eslint-disable-next-line unicorn/no-null -- React.FC takes null, not undefined
  if (!PgCallPanel.isOpen) return null;
  return <BaseCallPanel {...panelProps()} />;
};

/**
 * The panel on the phone, as a sheet over Code (prototype `TestSheet`): the
 * same panel, opened by the head's Call, and closed by a tap outside or
 * Escape, which close the panel itself
 */
export const CallSheet: FC = () => {
  useCallPanel();
  const open = PgCallPanel.isOpen;
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) PgCallPanel.close();
      }}
    >
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className={cn(SHEET, "h-[80dvh] max-h-[80dvh]")}
      >
        <div aria-hidden="true" className={SHEET_HANDLE} />
        <SheetTitle className="sr-only">Call</SheetTitle>
        <SheetDescription className="sr-only">
          Call the deployed program&apos;s instructions
        </SheetDescription>
        {/* The panel fills its parent (`absolute inset-0`) */}
        <div className="relative mt-3 min-h-0 flex-1 overflow-hidden">
          {open && <BaseCallPanel {...panelProps()} />}
        </div>
      </SheetContent>
    </Sheet>
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
