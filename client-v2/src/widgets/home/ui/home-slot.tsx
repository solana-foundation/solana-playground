import type { ReactNode } from "react";

import type { Viewport } from "@/shared/lib/hooks/use-viewport";
import { Spinner } from "@/shared/ui/spinner";
import type { StartView } from "../model/start-view";
import type { PageTile } from "../model/telemetry";
import Home from "./Home";
import PhoneHome from "./PhoneHome";

/** What the layout shell's `home` takes: Home, given the assistant's opener */
export type HomeSlot = (panel: { openAssistant: () => void }) => ReactNode;

/**
 * Home for the layout shell, by the page's view: none while the work shows,
 * a spinner in Home's place while the start is pending (so the editor does
 * not mount before the explorer has answered; `useStartView` gives up after
 * `START_TIMEOUT_MS`), then the phone's or the desktop's Home. `openPage`
 * opens the Tutorials or Programs page, which another widget owns.
 */
export const homeSlot = (
  view: StartView,
  viewport: Viewport,
  onContinue: () => void,
  openPage: (page: PageTile) => void
): HomeSlot | undefined => {
  if (view === "work") return undefined;
  return ({ openAssistant }) => {
    if (view === "pending")
      return (
        <div className="flex size-full items-center justify-center">
          <Spinner className="size-6 text-muted-foreground" />
        </div>
      );
    if (viewport === "phone") {
      return (
        <PhoneHome
          onAsk={openAssistant}
          onContinue={onContinue}
          onOpenPage={openPage}
        />
      );
    }
    return (
      <Home
        onAsk={openAssistant}
        onContinue={onContinue}
        onOpenPage={openPage}
      />
    );
  };
};
