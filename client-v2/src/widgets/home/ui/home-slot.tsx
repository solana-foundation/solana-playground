import type { ReactNode } from "react";

import type { Viewport } from "@/shared/lib/hooks/use-viewport";
import { Spinner } from "@/shared/ui/spinner";

import { PgAssistant } from "../../../views/sidebar/assistant/store";
import type { StartView } from "../model/start-view";
import type { HomeTile } from "../model/telemetry";
import Home from "./Home";
import PhoneHome from "./PhoneHome";

/**
 * What Home's ask box knows of the assistant before a send: the line that
 * says what a send will need, and whether a send can run at once
 */
export interface HomeAsk {
  hint: string | undefined;
  sends: boolean;
}

/** What the layout shell's `home` takes: Home, given the assistant's opener */
export type HomeSlot = (panel: { openAssistant: () => void }) => ReactNode;

/**
 * Home for the layout shell, by the page's view: none while the work shows,
 * a spinner in Home's place while the start is pending (so the editor does
 * not mount before the explorer has answered; `useStartView` gives up after
 * `START_TIMEOUT_MS`), then the phone's or the desktop's Home. `openPage`
 * opens the New project, Tutorials or Programs page, which another widget owns.
 */
export const homeSlot = (
  view: StartView,
  viewport: Viewport,
  onContinue: () => void,
  openPage: (page: HomeTile) => void,
  ask: HomeAsk
): HomeSlot | undefined => {
  if (view === "work") return undefined;
  return ({ openAssistant }) => {
    // The panel takes the question: sent at once when a model can answer,
    // else left in its composer under the off row, which asks for the
    // sign-in or the key
    const onAsk = (text: string) => {
      openAssistant();
      PgAssistant.requestPrompt(text, { send: ask.sends });
    };
    if (view === "pending")
      return (
        <div className="flex size-full items-center justify-center">
          <Spinner className="size-6 text-muted-foreground" />
        </div>
      );
    if (viewport === "phone") {
      return (
        <PhoneHome
          onAsk={onAsk}
          sendHint={ask.hint}
          onContinue={onContinue}
          onOpenPage={openPage}
        />
      );
    }
    return (
      <Home
        onAsk={onAsk}
        sendHint={ask.hint}
        onContinue={onContinue}
        onOpenPage={openPage}
      />
    );
  };
};
