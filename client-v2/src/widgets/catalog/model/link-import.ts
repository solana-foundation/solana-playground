import { GistImportError, importGist, parseGistUrl } from "@/features/gist";
import type {
  LinkImport,
  LinkImportFailure,
  LinkSource,
} from "@/features/new-project";
import { IMPORT_FALLBACK } from "@/features/new-project";
import type { GithubImportReason } from "@/utils";
import {
  ConversionError,
  GithubImportError,
  ImportCancelledError,
  PgGithub,
} from "@/utils";

/** A link that is neither a GitHub repository nor a gist */
export const BAD_LINK = "This isn't a GitHub repo or gist link.";

/**
 * A repository GitHub answers 404 for: private and missing look the same
 * without an account, so the message names both (designers' spec 10)
 */
const notFound = (owner: string, repo: string) =>
  `Playground can't find ${owner}/${repo} on GitHub. It may be private, ` +
  "renamed or deleted.";

const UNREACHABLE =
  "Could not reach GitHub. Check the connection and try again.";

/** Every reason but a bad link, which never reaches an import */
type ImportFailure = Exclude<LinkImportFailure, "bad-link">;

/**
 * `PgGithub`'s reasons as the card counts them: a refusal or a failed status
 * from GitHub is one the user can only retry
 */
const GITHUB_REASONS: Record<GithubImportReason, ImportFailure> = {
  "not-found": "not-found",
  "rate-limited": "rate-limited",
  "too-large": "too-large",
  "no-source": "no-program",
  network: "network",
  other: "network",
};

const failed = ({
  url,
  source,
  error,
}: {
  url: string;
  source: LinkSource;
  error: unknown;
}): Extract<LinkImport, { source: LinkSource }> => {
  const fail = (reason: ImportFailure, message: string) => ({
    outcome: "failed" as const,
    source,
    reason,
    message,
    error,
  });

  if (error instanceof GithubImportError) {
    if (error.reason === "not-found") {
      const { owner, repo } = PgGithub.parseUrl(url);
      return fail("not-found", notFound(owner, repo));
    }
    if (error.reason === "network") return fail("network", UNREACHABLE);
    return fail(GITHUB_REASONS[error.reason], error.message);
  }
  if (error instanceof ConversionError) {
    return fail("no-program", error.message);
  }
  if (error instanceof GistImportError) {
    // The gist import reported its own faults already; what it calls a
    // failed request is GitHub's, which the user can only retry
    return fail(
      error.reason === "request-failed" ? "network" : error.reason,
      error.message
    );
  }
  if (!(error instanceof Error)) return fail("unexpected", IMPORT_FALLBACK);
  return fail("unexpected", error.message || IMPORT_FALLBACK);
};

/** Which import takes the link: a gist page is on a GitHub host too */
const sourceOf = (url: string): LinkSource | undefined => {
  if (parseGistUrl(url)) return "gist";
  if (PgGithub.isValidUrl(url)) return "github";
  return undefined;
};

/**
 * Import New project's link as the explorer's dialog does: a gist link
 * to the gist import, a repository or folder link to `PgGithub.import`. A
 * link that is neither is refused before any request. Never throws: the
 * outcome says how it ended.
 *
 * @param link the field's text
 * @returns how the import ended
 */
export const importLink = async (link: string): Promise<LinkImport> => {
  const url = link.trim();
  const source = sourceOf(url);
  if (!source) {
    return {
      outcome: "failed",
      source: "unknown",
      reason: "bad-link",
      message: BAD_LINK,
    };
  }

  try {
    if (source === "gist") await importGist(url, "new-project");
    else await PgGithub.import(url);
  } catch (error) {
    if (error instanceof ImportCancelledError) return { outcome: "cancelled" };
    return failed({ url, source, error });
  }
  return { outcome: "imported", source };
};
