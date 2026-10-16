import { useEffect, useRef } from "react";

import { createLogger } from "@/shared/lib/logger";
import { PgView } from "@/utils/view";
import Connect from "../../../views/sidebar/assistant/Component/Connect";
import { PgAssistant } from "../../../views/sidebar/assistant/store";
import type { Connection } from "../../../views/sidebar/assistant/store";
import { ModalFrame } from "../../overlays";
import { useDefaultBackend } from "../model/default-backend";
import { assistantTelemetry } from "../model/telemetry";
import type { ConnectOpener, ConnectPreset } from "../model/use-turn";

const log = createLogger("assistant:connect");

/** The model a connection talks to: its own setting, or its endpoint's */
const modelOf = (connection: Connection) =>
  connection.settings?.model ?? connection.endpoint?.model;

/**
 * Whether `next` is a pick of something other than `before`: another
 * backend, model or effort. A new key alone, or the same choice again, is not.
 */
const isNewPick = (before: Connection | null, next: Connection) =>
  !before ||
  before.id !== next.id ||
  modelOf(before) !== modelOf(next) ||
  before.settings?.effort !== next.settings?.effort;

interface ConnectDialogProps {
  /** The backend, and maybe the model, the form opens on */
  preset?: ConnectPreset;
}

/**
 * Connect a model: the legacy `Connect` form in a dialog of `PgView`'s stack.
 * Closes itself with the connection on the first one made while it is open.
 *
 * `PgAssistant.isPickingBackend` says it is open for exactly as long as this
 * is mounted. Not for as long as its `setModal` is pending: `closeModal`
 * answers every pending one (HOO-2091), so a dialog stacked on this one
 * closing would end it while this is still on screen. `ModalHost` keeps a
 * lower dialog mounted, so the cleanup runs only when this one is popped.
 */
const ConnectDialog = ({ preset }: ConnectDialogProps) => {
  const probed = useDefaultBackend();
  // Above `ModalFrame`, so a dialog stacked on this one does not reset it
  const opened = useRef(PgAssistant.connection);
  const closed = useRef(false);

  useEffect(() => {
    // Marked by `openConnectDialog` before this mounts; marked again after
    // StrictMode's extra cleanup has cleared it
    if (!PgAssistant.isPickingBackend && !closed.current) {
      PgAssistant.pickBackend();
    }
    const sub = PgAssistant.onDidChange(() => {
      const connection = PgAssistant.connection;
      // `connect` always stores a new object, so re-picking the backend
      // already connected counts as a connection too
      if (!connection || connection === opened.current) return;
      // The store emits again before this unmounts; a second close would
      // take whatever dialog is under this one with it
      if (closed.current) return;
      closed.current = true;
      try {
        PgView.closeModal(connection);
      } catch (error) {
        // Still on screen: the next connection made in it closes it
        closed.current = false;
        log.error(error, { report: true, context: { step: "close" } });
        return;
      }
      // Re-picking what was connected closes the dialog but picks nothing
      if (isNewPick(opened.current, connection)) {
        assistantTelemetry.track("assistant_model_picked", {
          provider: connection.id,
          via: "dialog",
        });
      }
    });
    return () => {
      sub.dispose();
      // Closed with no connection (Escape, Close, a press outside, a crash)
      if (PgAssistant.isPickingBackend) PgAssistant.keepBackend();
    };
  }, []);

  return (
    // The form is the frame's body, its action the frame's submit: a phone
    // pins the footer to the bottom of the screen, so the action never
    // scrolls away with the form. The form holds its state above the frame,
    // so a dialog stacked on this one does not reset what was typed.
    <Connect
      defaultBackend={probed.state}
      preset={preset}
      frame={({ action, form }) => (
        <ModalFrame
          name="connect-model"
          title="Connect a model"
          buttonProps={{
            text: action.text,
            disabled: !action.ready,
            onSubmit: action.connect,
            // Connect is the one call to action here (design 5.4)
            variant: "brand",
            // The dialog closes itself on the connection, with it as the
            // answer
            noCloseOnSubmit: true,
          }}
        >
          {form}
        </ModalFrame>
      )}
    />
  );
};

const CouldNotOpen = () => (
  <span>
    <strong>Could not open Connect a model.</strong> Reload the page and try
    again.
  </span>
);

/**
 * Open Connect a model, unless it is open already.
 *
 * Marks it open at once, so the reconnects on load, a send with nothing
 * connected and a second open all stand down before the dialog has mounted;
 * from then on `ConnectDialog` holds the mark. Its answer is not read here
 * (see `ConnectDialog`).
 */
export const openConnectDialog: ConnectOpener = (via, preset) => {
  if (PgAssistant.isPickingBackend) return;
  assistantTelemetry.track("assistant_connect_opened", { via });
  PgAssistant.pickBackend();

  PgView.setModal<unknown, ConnectDialogProps>(ConnectDialog, { preset }).catch(
    (error) => {
      // `setModal` rejects only when the dialog host answers with an error;
      // the user is left without the dialog, so the team must hear of it,
      // and the user is told why nothing opened
      log.error(error, { report: true, context: { via } });
      PgView.setToast(CouldNotOpen, {
        options: { name: "connect-model-failed" },
      });
      // Nothing is choosing any more: a send may connect the default again
      if (PgAssistant.isPickingBackend) PgAssistant.keepBackend();
    }
  );
};
