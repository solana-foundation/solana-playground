import { Button } from "@/shared/ui/button";

import type { KeyHold } from "../../../views/sidebar/assistant/model/types";
import BaseSettingRow from "./BaseSettingRow";

/** The user's own key, as the row reads it (`KeyHold`) */
export type AssistantKeyState = KeyHold;

interface BaseAssistantKeyProps {
  state: AssistantKeyState;
  /**
   * Set when the last delete left a key an older build kept in this tab's
   * storage: what the row says in place of its description, since the
   * panel's notice sits under Settings
   */
  stuck?: string;
  onDelete: () => void;
  phone: boolean;
}

const DESCRIPTIONS: Record<AssistantKeyState, string> = {
  none: "No key entered. The hosted model needs none.",
  ready: "Kept in this tab only. Deleting it clears the chat on screen.",
  busy: "In use by the reply being written. Delete it once that ends.",
};

/** The row that deletes the user's own model key */
const BaseAssistantKey = ({
  state,
  stuck,
  onDelete,
  phone,
}: BaseAssistantKeyProps) => (
  <BaseSettingRow
    name="Your model key"
    description={stuck ?? DESCRIPTIONS[state]}
    phone={phone}
    // Quiet until there is a key to delete
    small={!phone}
    control={
      <Button
        variant={state === "ready" ? "destructive" : "ghost"}
        size={phone ? "default" : "sm"}
        className={phone ? "h-11 w-full rounded-lg" : undefined}
        disabled={state !== "ready"}
        onClick={onDelete}
      >
        Delete my key
      </Button>
    }
  />
);

export default BaseAssistantKey;
