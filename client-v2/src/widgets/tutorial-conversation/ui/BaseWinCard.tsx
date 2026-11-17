import { FileCode, Send } from "lucide-react";
import { useEffect } from "react";

import type { Win } from "@/entities/tutorial";
import type { PassedVia, PassReason } from "@/features/tutorial-conversation";
import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";
import { Kbd } from "@/shared/ui/kbd";
import { Tag } from "@/shared/ui/tag";

import { nextStepLabel, stepDoneLabel } from "../model/card-labels";
import { BaseDrawnCheck } from "./BaseDrawnCheck";
import { PHONE_CTA } from "./card-action";
import { nothingFocused } from "./keys";
import { phoneCtaWidth, usePhone } from "./phone";
import { HEADLINE, noStop, Prose, READ } from "./Prose";

export interface BaseWinCardProps {
  win: Win;
  /** 1-based */
  index: number;
  /** The next step's title; null on the last step, whose win has no Next */
  next: string | null;
  /** How the step passed: a Call panel pass reads its own line */
  via: PassedVia;
  /** `exists`: the account the goal creates was already there, and the win reads `existsLine` */
  reason?: PassReason;
  /** The card acts: the win is live and Next not yet pressed */
  live: boolean;
  onNext: () => void;
  /**
   * Open the Call panel, for a win whose definition asks for it
   * (`extra: "openTest"`). Absent until the panel can be opened; the button
   * shows only with it
   */
  onOpenCall?: () => void;
  /** Open `client/client.ts`, after a pass from the Call panel */
  onWriteInClient: () => void;
}

/**
 * The card a passed step ends on: a drawn check, "Step n done", the
 * definition's headline and line, and "Next: <step>" with ↵. Enter presses
 * Next while the card is live and nothing else holds focus, as on the intro.
 * A pass from the Call panel reads the definition's `callPanelLine` and
 * offers "Write it in client.ts"; a pass on an account that already existed
 * reads `existsLine` over both; a win that asks for it offers "Open Call".
 * The last step's win has no Next: the finish follows it. Once Next is
 * pressed the card is a record: the check, the tag and the headline, with
 * "Open Call" and "Write it in client.ts" kept as small buttons, since they
 * only navigate (spec: navigation links in a record stay live).
 */
const BaseWinCard = ({
  win,
  index,
  next,
  via,
  reason,
  live,
  onNext,
  onOpenCall,
  onWriteInClient,
}: BaseWinCardProps) => {
  const layout = usePhone();
  const { phone } = layout;
  const fromPanel = via === "call_panel";
  const canNext = live && next !== null;
  // A navigation link: it stays on the record, as "Write it in client.ts" does
  // After a pass from the panel, the next thing is the code, not the panel
  // Not on the phone: Code's head holds Call there
  const openCall =
    win.extra === "openTest" && !fromPanel && !phone ? onOpenCall : undefined;

  useEffect(() => {
    if (!canNext) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.defaultPrevented || !nothingFocused()) return;
      e.preventDefault();
      onNext();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [canNext, onNext]);

  let line = fromPanel && win.callPanelLine ? win.callPanelLine : win.line;
  if (reason === "exists" && win.existsLine) line = win.existsLine;
  const writeInClient = fromPanel && (
    <Button
      variant="outline"
      size={live ? "default" : "xs"}
      onClick={onWriteInClient}
    >
      <FileCode aria-hidden="true" />
      Write it in client.ts
    </Button>
  );

  return (
    <section
      aria-label={stepDoneLabel(index)}
      className="flex flex-col gap-3 rounded-panel border border-border bg-surface-panel p-4"
    >
      <div className="flex items-start gap-3">
        <BaseDrawnCheck draw={live} />
        {/* One column beside the check, so the line and the buttons start
            where the headline does */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Tag className="w-fit">{stepDoneLabel(index)}</Tag>
            <p className={HEADLINE}>
              <Prose text={noStop(win.headline, phone)} />
            </p>
          </div>
          {live && (
            <p className={READ}>
              <Prose text={line} />
            </p>
          )}
          {(canNext || openCall || fromPanel) && (
            <div className="flex flex-wrap items-center gap-2">
              {canNext && (
                <Button
                  onClick={onNext}
                  className={cn(phone && PHONE_CTA, phoneCtaWidth(layout))}
                >
                  {nextStepLabel(next)}
                  {!phone && (
                    <Kbd
                      aria-hidden="true"
                      className="bg-white/15 text-primary-foreground/80"
                    >
                      ↵
                    </Kbd>
                  )}
                </Button>
              )}
              {openCall && (
                <Button
                  variant="outline"
                  size={live ? "default" : "xs"}
                  onClick={openCall}
                >
                  <Send aria-hidden="true" />
                  Open Call
                </Button>
              )}
              {writeInClient}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default BaseWinCard;
