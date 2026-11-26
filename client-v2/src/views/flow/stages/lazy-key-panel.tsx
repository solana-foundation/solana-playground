import type { ComponentType } from "react";

import { createLogger } from "@/shared/lib/logger";
import { CalloutAction } from "@/shared/ui/callout";

import type { KeyPanelProps } from "../../../components/Wallet/KeyPanel";

const log = createLogger("flow:deploy");

/** What the deploy card's backup line hands the key panel it loads */
type LoadedKeyPanel = ComponentType<KeyPanelProps>;

/** Told on the fallback's click: the user can do nothing here but reload */
export const KEY_PANEL_LOAD_FAILED =
  "The key storage did not load. Reload the page and try again.";

/**
 * The key panel's chunk, for `lazy`. A chunk that does not load (a deploy
 * replaced it, or the network dropped) leaves a Save keypair that says so on
 * its click, rather than taking the deploy card down with it
 */
export const loadKeyPanel =
  (load: () => Promise<{ KeyPanel: LoadedKeyPanel }>) =>
  (): Promise<{ default: LoadedKeyPanel }> =>
    load().then(
      (m) => ({ default: m.KeyPanel }),
      (error: unknown) => {
        log.error(error, { context: { what: "load the key panel" } });
        return {
          default: ({ onError }: KeyPanelProps) => (
            <CalloutAction onClick={() => onError(KEY_PANEL_LOAD_FAILED)}>
              Save keypair
            </CalloutAction>
          ),
        };
      }
    );
