import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

import { PROJECT_NAME } from "@/constants";
import { useViewport } from "@/shared/lib/hooks/use-viewport";
import { createLogger } from "@/shared/lib/logger";
import { PgView } from "@/utils/view";

import { overlayTelemetry } from "../model/telemetry";
import type {
  ModalSize,
  OpenFocus,
  SubmitStatus,
  SubmitVariant,
} from "./BaseModalFrame";
import { BaseModalFrame } from "./BaseModalFrame";
import {
  useBlockDismiss,
  useIsTopModal,
  useModalId,
  useOpenReport,
} from "./modal-layer";

const log = createLogger("overlays:modal-frame");

export type ModalSubmit = {
  /** Button label */
  text: string;
  /** What the button does; without it the button only closes the dialog */
  onSubmit?: () => unknown | Promise<unknown>;
  /** Keep the dialog open after a successful submit */
  noCloseOnSubmit?: boolean;
  /**
   * No Cancel beside the submit: for a dialog whose work is already done
   * (a share made, its link to copy), where Cancel would read as an undo.
   * Close in the head stays
   */
  noCancel?: boolean;
  disabled?: boolean;
  /**
   * Another part of the dialog still works, such as a key panel saving or
   * importing: the submit and Cancel wait, as Escape and a press outside do
   * through `useBlockDismiss`, so closing cannot drop that work's result
   */
  isHeld?: boolean;
  /** `brand` for the view's one call to action; see `SubmitVariant` */
  variant?: SubmitVariant;
  /** Drawn before the label, at the button's icon size; the spinner takes its place while busy */
  icon?: ReactNode;
};

export type ModalFrameProps = {
  /** Telemetry name, kebab-case, never user content */
  name: string;
  /** The heading; `true` is the product's name */
  title?: string | true;
  buttonProps?: ModalSubmit;
  size?: ModalSize;
  /** Where the focus lands on open; the body's first field (or the submit) when left out */
  openFocus?: OpenFocus;
  children?: ReactNode;
};

/**
 * Thrown by a submit the user abandoned on the way (closed a dialog it
 * opened, for one): the dialog stays open, shows nothing and reports nothing.
 */
export class SubmitCancelled extends Error {
  constructor() {
    super("Submit cancelled");
    this.name = "SubmitCancelled";
  }
}

/**
 * Spec 08's fallback (ANY-00, in its 29 Oct wording) for a submit that threw
 * nothing to show: "Could not {action}.", never a generic error. The action is
 * the submit's label without its closing punctuation, its first letter
 * lower-cased ("Delete…" reads "delete") unless the label opens on an acronym;
 * a label with nothing left of it reads "do that".
 * A dialog has no log to point at, so it ends on the retry its button offers.
 */
const unknownError = (action: string) => {
  const verb = action.replace(/[\s.…?!:]+$/u, "");
  if (!verb) return "Could not do that. Try again.";
  // An acronym or a name that opens the label ("API key", "SOL transfer") keeps its case
  const what = /^[A-Z][a-z]/.test(verb)
    ? verb.charAt(0).toLowerCase() + verb.slice(1)
    : verb;
  return `Could not ${what}. Try again.`;
};

/** The message to show for whatever the `action` submit threw; never empty */
const messageOf = (error: unknown, action: string) => {
  // TODO: carry failures as a Result (ok | err) so a non-Error never reaches here
  if (typeof error === "string") return error || unknownError(action);
  // An `Error`, or a plain `{ message }`
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message
  ) {
    return error.message;
  }
  return unknownError(action);
};

/**
 * The frame of a dialog opened with `PgView.openModal` or `setModal`. A
 * submit closes the dialog with what it returned; a submit that throws keeps
 * it open and shows the message. While a submit runs the dialog cannot be
 * dismissed, so its answer goes to the dialog that asked.
 */
export const ModalFrame = ({
  name,
  title,
  buttonProps,
  size = "default",
  openFocus,
  children,
}: ModalFrameProps) => {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  // `busy` lags a render behind, so two Enters in one tick both saw it false
  const submitting = useRef(false);
  // A frame gone mid-submit (its dialog closed from elsewhere, or `ModalPages`
  // moved on to another page) must not close its dialog when the submit
  // settles
  const mounted = useRef(true);
  const isTop = useIsTopModal();
  const id = useModalId();
  // Read while the dialog is open: by the time it closes, it is off the stack
  const opener = useRef(
    PgView.getOpenModals().find((modal) => modal.id === id)?.opener ?? null
  );
  const openReport = useOpenReport();
  const blockDismiss = useBlockDismiss();
  const phone = useViewport() === "phone";

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // StrictMode runs an effect twice on mount and keeps refs across the pair,
  // so the name last reported here is what keeps the dev server's count at one
  const reportedName = useRef<string | null>(null);
  useEffect(() => {
    // Inside `ModalPages` the dialog is reported once for all its pages
    if (openReport) {
      openReport();
      return;
    }
    if (reportedName.current === name) return;
    reportedName.current = name;
    overlayTelemetry.track("overlay_modal_opened", { name });
  }, [name, openReport]);

  useEffect(() => {
    if (!isTop) return;
    blockDismiss(busy);
    return () => blockDismiss(false);
  }, [busy, isTop, blockDismiss]);

  const submit = async () => {
    if (
      !buttonProps ||
      buttonProps.disabled ||
      buttonProps.isHeld ||
      submitting.current
    ) {
      return;
    }
    if (!buttonProps.onSubmit) {
      PgView.closeModal(null, id);
      return;
    }
    submitting.current = true;
    setBusy(true);
    // A retry that succeeds must not keep the last attempt's message
    setError(undefined);
    try {
      const data = await buttonProps.onSubmit();
      if (mounted.current && !buttonProps.noCloseOnSubmit) {
        // By id: another dialog may have opened on this one meanwhile
        PgView.closeModal(data, id);
      }
    } catch (e) {
      if (e instanceof SubmitCancelled) {
        log.debug("submit cancelled by the user", { context: { name } });
        return;
      }
      // The user reads the message in the dialog; the team hears of it so a
      // pattern of failing dialogs shows up
      log.error(e, { report: true, context: { name } });
      overlayTelemetry.track("overlay_modal_submit_failed", { name });
      if (mounted.current) setError(messageOf(e, buttonProps.text));
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  // Radix sends focus to the dialog's `Trigger`, and these dialogs open with
  // none, so without this focus is lost to `<body>`. While any dialog is open
  // (this one covered, or another opened in its place) the one on top holds
  // focus; the opener gets it back only once none is.
  const returnFocus = (event: Event) => {
    event.preventDefault();
    if (PgView.getOpenModals().length) return;
    if (opener.current?.isConnected) opener.current.focus();
  };

  // Under another dialog: draw no second dialog content. Only the state held
  // above this frame survives; the frame's subtree remounts when it is on
  // top again (see `ModalLayerContext`)
  if (!isTop) return <div hidden>{children}</div>;

  let status: SubmitStatus = "ready";
  if (busy) status = "busy";
  else if (buttonProps?.isHeld) status = "held";
  else if (buttonProps?.disabled) status = "disabled";

  return (
    <BaseModalFrame
      phone={phone}
      title={{
        text: typeof title === "string" && title ? title : PROJECT_NAME,
        hidden: !title,
      }}
      error={error}
      submit={
        buttonProps && {
          text: buttonProps.text,
          status,
          variant: buttonProps.variant ?? "default",
          icon: buttonProps.icon,
          onSubmit: submit,
          onCancel:
            buttonProps.onSubmit && !buttonProps.noCancel
              ? () => PgView.closeModal(null, id)
              : undefined,
        }
      }
      size={size}
      openFocus={openFocus}
      onCloseAutoFocus={returnFocus}
    >
      {children}
    </BaseModalFrame>
  );
};
