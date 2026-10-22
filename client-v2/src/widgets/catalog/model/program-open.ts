import { ImportCancelledError, PgGithub } from "@/utils";
import type { ImportProgress } from "@/utils";

/** Where an import is, in the user's terms */
const progressText = ({ loaded, total }: ImportProgress) =>
  total === null
    ? "Reading the repository…"
    : `Downloading ${loaded}/${total} files…`;

/** Closing the program selection is a choice, not a failure */
export const isImportCancel = (e: unknown) => e instanceof ImportCancelledError;

/**
 * A program card's Open for `useCardOpen`: imports the repository as a
 * project (`PgGithub.import`), its progress on the card
 */
export const importProgram =
  (repo: string) => (report: (text: string) => void) =>
    PgGithub.import(repo, (next) => report(progressText(next)));
