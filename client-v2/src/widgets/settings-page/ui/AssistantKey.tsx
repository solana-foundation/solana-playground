import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { dropKeptKey } from "../../../views/sidebar/assistant/model/remembered-backend";
import { assistantKeyTelemetry } from "../../../views/sidebar/assistant/model/telemetry";
import {
  KEY_NOT_FORGOTTEN,
  PgAssistant,
} from "../../../views/sidebar/assistant/store";
import BaseAssistantKey from "./BaseAssistantKey";

const subscribe = (onChange: () => void) =>
  PgAssistant.onDidChange(onChange).dispose;

/** The store's `keyHold`, which the head's More reads too */
const stateOf = () => PgAssistant.keyHold;

interface AssistantKeyProps {
  phone: boolean;
  /** The model the key runs, as the assistant names it, while one is connected */
  ownKey?: string;
  /** Whether this deployment serves its hosted model to this user */
  isHostedAvailable?: boolean;
}

/**
 * `BaseAssistantKey` on the live connection. Delete my key is the head's
 * More item too: both are `PgAssistant.disconnect` (HOO-2423).
 */
const AssistantKey = ({
  phone,
  ownKey,
  isHostedAvailable = false,
}: AssistantKeyProps) => {
  const state = useSyncExternalStore(subscribe, stateOf);
  // Settings can open with the panel folded, or on a phone with the chat
  // closed, where the panel's own cleanup on mount has not run: what an older
  // build kept must not outlive a row that says there is no key
  const [stuck, setStuck] = useState(false);
  useEffect(() => setStuck(!dropKeptKey()), []);

  // "Deleted" stays until a key is connected again (HOO-2695). The delete
  // disables the button that had focus, so focus moves to the word
  const [isDeleted, setIsDeleted] = useState(false);
  const done = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (state === "ready") setIsDeleted(false);
  }, [state]);
  useEffect(() => {
    if (isDeleted) done.current?.focus();
  }, [isDeleted]);

  return (
    <BaseAssistantKey
      state={state}
      ownKey={ownKey}
      isHostedAvailable={isHostedAvailable}
      stuck={stuck ? KEY_NOT_FORGOTTEN : undefined}
      isDeleted={isDeleted}
      doneRef={done}
      phone={phone}
      onDelete={() => {
        const isForgotten = PgAssistant.disconnect();
        setStuck(!isForgotten);
        // A key an older build kept and could not drop is not deleted: the
        // row says that instead
        setIsDeleted(isForgotten);
        assistantKeyTelemetry.track("assistant_key_deleted", {
          via: "settings",
        });
      }}
    />
  );
};

export default AssistantKey;
