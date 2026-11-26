import { KeyRound } from "lucide-react";
import type { ReactNode } from "react";

import { networkInSentence, UNKNOWN_NETWORK } from "@/constants";
import {
  Callout,
  CalloutAction,
  CalloutActions,
  CalloutDescription,
} from "@/shared/ui/callout";

export interface BaseBackupLineProps {
  cluster: string | null;
  /**
   * The Save keypair button, a `CalloutAction`: one that saves the key the
   * page holds, or under the key origin the key page's own, which saves on
   * its own click
   */
  save: ReactNode;
  onDismiss: () => void;
}

/** Under a deploy result: the program is tied to this browser's Playground wallet */
const BaseBackupLine = ({ cluster, save, onDismiss }: BaseBackupLineProps) => (
  <Callout variant="info" aria-label="Keypair backup">
    <KeyRound />
    <CalloutDescription>
      Your program on {networkInSentence(cluster) ?? UNKNOWN_NETWORK} is tied to
      this browser's Playground wallet. Save the keypair so you can update it
      from another browser.
    </CalloutDescription>
    <CalloutActions>
      {save}
      <CalloutAction quiet onClick={onDismiss}>
        Not now
      </CalloutAction>
    </CalloutActions>
  </Callout>
);

export default BaseBackupLine;
