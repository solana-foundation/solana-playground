import { PgView } from "@/utils";
import { errorMessage } from "../lib/error-message";

/**
 * Tell the user that something Home was asked to open did not open. The
 * caller logs the failure; this is only what the user sees.
 */
export const toastActionFailed = (e: unknown) =>
  PgView.setToast(
    () => (
      <span>
        <strong>Could not open.</strong> {errorMessage(e, "Try again.")}
      </span>
    ),
    { options: { name: "home-action-failed" } }
  );
