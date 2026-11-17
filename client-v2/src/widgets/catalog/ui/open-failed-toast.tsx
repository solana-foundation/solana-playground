import { PgView } from "@/utils";

/** A failure toast: `lead` in bold, then the message */
const toastFailed =
  ({ lead, name }: { lead: string; name: string }) =>
  (message: string) =>
    PgView.setToast(
      () => (
        <span>
          <strong>{lead}</strong> {message}
        </span>
      ),
      { options: { name } }
    );

/**
 * Tell the user an Open failed where no card shows it: New project was left,
 * or the card's list is not the one shown. The Open logged the failure; this
 * is what they see.
 */
export const toastOpenFailed = toastFailed({
  lead: "Could not open.",
  name: "new-project-open-failed",
});

/** The same for Start from scratch, once New project was left */
export const toastStartFailed = toastFailed({
  lead: "Could not create the project.",
  name: "new-project-start-failed",
});

/** The same for Import from GitHub, once New project was left */
export const toastImportFailed = toastFailed({
  lead: "Could not import.",
  name: "new-project-import-failed",
});
