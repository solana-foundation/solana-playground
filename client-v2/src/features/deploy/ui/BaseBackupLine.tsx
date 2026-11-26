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
  onSave: () => void;
  onDismiss: () => void;
  /**
   * The key page's own Save keypair, under the key origin, where the page
   * holds no key to save: it saves on its own click, in place of the button
   * that calls `onSave`
   */
  save?: ReactNode;
}

/** Under a deploy result: the program is tied to this browser's Playground wallet */
const BaseBackupLine = ({
  cluster,
  onSave,
  onDismiss,
  save,
}: BaseBackupLineProps) => (
  <Callout variant="info" aria-label="Keypair backup">
    <KeyRound />
    <CalloutDescription>
      Your program on {networkInSentence(cluster) ?? UNKNOWN_NETWORK} is tied to
      this browser's Playground wallet. Save the keypair so you can update it
      from another browser.
    </CalloutDescription>
    <CalloutActions>
      {save ?? <CalloutAction onClick={onSave}>Save keypair</CalloutAction>}
      <CalloutAction quiet onClick={onDismiss}>
        Not now
      </CalloutAction>
    </CalloutActions>
  </Callout>
);

export default BaseBackupLine;
