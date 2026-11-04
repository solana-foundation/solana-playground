import { useEffect, useState, useSyncExternalStore } from "react";

import { dropKeptKey } from "../../../views/sidebar/assistant/model/remembered-backend";
import {
  KEY_NOT_FORGOTTEN,
  PgAssistant,
} from "../../../views/sidebar/assistant/store";
import { settingsTelemetry } from "../model/telemetry";
import BaseAssistantKey from "./BaseAssistantKey";

const subscribe = (onChange: () => void) =>
  PgAssistant.onDidChange(onChange).dispose;

/** The store's `keyHold`, which the head's More reads too */
const stateOf = () => PgAssistant.keyHold;

/**
 * `BaseAssistantKey` on the live connection. Delete my key is the head's
 * More item too: both are `PgAssistant.disconnect` (HOO-2423).
 */
const AssistantKey = ({ phone }: { phone: boolean }) => {
  const state = useSyncExternalStore(subscribe, stateOf);
  // Settings can open with the panel folded, or on a phone with the chat
  // closed, where the panel's own cleanup on mount has not run: what an older
  // build kept must not outlive a row that says there is no key
  const [stuck, setStuck] = useState(false);
  useEffect(() => setStuck(!dropKeptKey()), []);
  return (
    <BaseAssistantKey
      state={state}
      stuck={stuck ? KEY_NOT_FORGOTTEN : undefined}
      phone={phone}
      onDelete={() => {
        setStuck(!PgAssistant.disconnect());
        settingsTelemetry.track("settings_key_deleted", {});
      }}
    />
  );
};

export default AssistantKey;
