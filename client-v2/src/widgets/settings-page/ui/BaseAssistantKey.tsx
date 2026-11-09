import { Check } from "lucide-react";
import type { Ref } from "react";

import { cn } from "@/shared/lib/utils";
import { Button } from "@/shared/ui/button";

import type { KeyHold } from "../../../views/sidebar/assistant/model/types";
import BaseSettingRow from "./BaseSettingRow";

/** The user's own key, as the row reads it (`KeyHold`) */
export type AssistantKeyState = KeyHold;

interface BaseAssistantKeyProps {
  state: AssistantKeyState;
  /** The model the key runs, as the assistant names it, while one is connected */
  ownKey?: string;
  /** Whether this deployment serves its hosted model to this user */
  isHostedAvailable: boolean;
  /**
   * Set when the last delete left a key an older build kept in this tab's
   * storage: what the row says in place of its description, since the
   * panel's notice sits under Settings
   */
  stuck?: string;
  /** A delete went through and no key was connected since: the row says so */
  isDeleted: boolean;
  /** The "Deleted" word, where focus goes from the button a delete disables */
  doneRef?: Ref<HTMLSpanElement>;
  onDelete: () => void;
  phone: boolean;
}

/** What the row says; it never suggests the hosted model is in use when it is not */
const description = ({
  state,
  ownKey,
  isHostedAvailable,
}: Pick<BaseAssistantKeyProps, "state" | "ownKey" | "isHostedAvailable">) => {
  switch (state) {
    case "none":
      return isHostedAvailable
        ? "No key entered. The hosted model needs none."
        : "No key entered.";
    case "busy":
      return "In use by the reply being written. Delete it once that ends.";
    case "ready":
      if (!ownKey) {
        return "Kept in this tab only. Deleting it clears the chat on screen.";
      }
      return isHostedAvailable
        ? `Chat uses ${ownKey} with this key. The key stays in this tab only. The hosted model is available too.`
        : `Chat uses ${ownKey} with this key. The key stays in this tab only. Deleting it clears the chat on screen.`;
  }
};

/**
 * The row that deletes the user's own model key. Once a delete has gone
 * through it says "Deleted" beside the button, which the delete disabled.
 */
const BaseAssistantKey = ({
  state,
  ownKey,
  isHostedAvailable,
  stuck,
  isDeleted,
  doneRef,
  onDelete,
  phone,
}: BaseAssistantKeyProps) => (
  <BaseSettingRow
    name="Your model key"
    description={stuck ?? description({ state, ownKey, isHostedAvailable })}
    phone={phone}
    // Quiet until there is a key to delete
    small={!phone}
    control={
      <div className={cn("flex items-center gap-3", phone && "w-full")}>
        {/* Always in the tree, so a screen reader announces the word as it appears */}
        <span
          ref={doneRef}
          role="status"
          tabIndex={-1}
          className="flex shrink-0 items-center gap-1.5 text-caption text-muted-foreground outline-none empty:hidden max-md:text-control"
        >
          {isDeleted && (
            <>
              <Check className="size-3.5" aria-hidden />
              Deleted
            </>
          )}
        </span>
        <Button
          variant={state === "ready" ? "destructive" : "ghost"}
          size={phone ? "default" : "sm"}
          className={phone ? "h-11 flex-1 rounded-lg" : undefined}
          disabled={state !== "ready"}
          onClick={onDelete}
        >
          Delete my key
        </Button>
      </div>
    }
  />
);

export default BaseAssistantKey;
