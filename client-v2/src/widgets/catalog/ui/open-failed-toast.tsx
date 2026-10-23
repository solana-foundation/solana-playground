import { PgView } from "@/utils";

/**
 * Tell the user an Open failed after New project was dismissed, when no card
 * is left to show it. The Open logged the failure; this is what they see.
 */
export const toastOpenFailed = (message: string) =>
  PgView.setToast(
    () => (
      <span>
        <strong>Could not open.</strong> {message}
      </span>
    ),
    { options: { name: "new-project-open-failed" } }
  );
