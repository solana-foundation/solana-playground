import { KeyRound } from "lucide-react";

import { Button } from "@/shared/ui/button";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import { networkName } from "../model/format";

export interface BaseBackupLineProps {
  cluster: string | null;
  onSave: () => void;
  onDismiss: () => void;
}

/** Under a deploy result: the program is tied to this browser's wallet */
const BaseBackupLine = ({
  cluster,
  onSave,
  onDismiss,
}: BaseBackupLineProps) => (
  <Callout variant="info" aria-label="Keypair backup">
    <KeyRound />
    <CalloutDescription className="flex flex-col gap-2">
      <span>
        Your program on {networkName(cluster)} is tied to this browser's wallet.
        Save the keypair so you can update it from another browser.
      </span>
      <span className="flex gap-2">
        <Button size="sm" onClick={onSave}>
          Save keypair
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Not now
        </Button>
      </span>
    </CalloutDescription>
  </Callout>
);

export default BaseBackupLine;
