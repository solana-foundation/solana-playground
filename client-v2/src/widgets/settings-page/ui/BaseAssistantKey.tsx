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
  none: "No key entered. The default model needs none.",
  ready:
    "Held in this tab's memory only. A reload asks for it again. Deleting it also clears the conversation on screen.",
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
    control={
      <Button
        variant="destructive"
        className={phone ? "h-12 w-full rounded-xl" : "w-full"}
        disabled={state !== "ready"}
        onClick={onDelete}
      >
        Delete my key
      </Button>
    }
  />
);

export default BaseAssistantKey;
