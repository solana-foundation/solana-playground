import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { createLogger } from "@/shared/lib/logger";
import { PROJECT_NAME } from "@/constants";
import { PgView } from "@/utils/view";
import { overlayTelemetry } from "../model/telemetry";
import { BaseModalFrame } from "./BaseModalFrame";
import type { ModalSize, SubmitStatus, SubmitVariant } from "./BaseModalFrame";
import { useBlockDismiss, useIsTopModal, useOpenReport } from "./modal-layer";

const log = createLogger("overlays:modal-frame");

export type ModalSubmit = {
  /** Button label */
  text: string;
  /** What the button does; without it the button only closes the dialog */
  onSubmit?: () => unknown | Promise<unknown>;
  /** Keep the dialog open after a successful submit */
  noCloseOnSubmit?: boolean;
  disabled?: boolean;
  /** `brand` for the view's one call to action; see `SubmitVariant` */
  variant?: SubmitVariant;
};

export type ModalFrameProps = {
  /** Telemetry name, kebab-case, never user content */
  name: string;
  /** The heading; `true` is the product's name */
  title?: string | true;
  buttonProps?: ModalSubmit;
  size?: ModalSize;
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

const UNKNOWN_ERROR = "Something went wrong";

/** The message to show for whatever a submit threw; never empty */
const messageOf = (error: unknown) => {
  if (typeof error === "string") return error || UNKNOWN_ERROR;
  // An `Error`, or the bare `{ message }` that
  // `PgCommon.sendAndReceiveCustomEvent` rejects with
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message
  ) {
    return error.message;
  }
  return UNKNOWN_ERROR;
};

/**
 * The frame of a dialog opened with `PgView.setModal`. A submit closes the
 * dialog with what it returned; a submit that throws keeps it open and shows
 * the message. While a submit runs the dialog cannot be dismissed, so its
 * answer goes to the dialog that asked.
 */
export const ModalFrame = ({
  name,
  title,
  buttonProps,
  size = "default",
  children,
}: ModalFrameProps) => {
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  // `busy` lags a render behind, so two Enters in one tick both saw it false
  const submitting = useRef(false);
  // A frame closed from elsewhere mid-submit must not close whatever dialog
  // is on top by the time its submit settles
  const mounted = useRef(true);
  const isTop = useIsTopModal();
  const openReport = useOpenReport();
  const blockDismiss = useBlockDismiss();

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
    if (!buttonProps || buttonProps.disabled || submitting.current) return;
    if (!buttonProps.onSubmit) {
      PgView.closeModal(null);
      return;
    }
    submitting.current = true;
    setBusy(true);
    // A retry that succeeds must not keep the last attempt's message
    setError(undefined);
    try {
      const data = await buttonProps.onSubmit();
      if (mounted.current && !buttonProps.noCloseOnSubmit) {
        PgView.closeModal(data);
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
      if (mounted.current) setError(messageOf(e));
    } finally {
      submitting.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  // Under another dialog: draw no second dialog content. Only the state held
  // above this frame survives; the frame's subtree remounts when it is on
  // top again (see `ModalLayerContext`)
  if (!isTop) return <div hidden>{children}</div>;

  let status: SubmitStatus = "ready";
  if (busy) status = "busy";
  else if (buttonProps?.disabled) status = "disabled";

  return (
    <BaseModalFrame
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
          onSubmit: submit,
          onCancel: buttonProps.onSubmit
            ? () => PgView.closeModal(null)
            : undefined,
        }
      }
      size={size}
    >
      {children}
    </BaseModalFrame>
  );
};
