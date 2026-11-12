/** What a failure that carries no message of its own says */
export const IMPORT_FALLBACK = "Could not import it.";

/** Which import a link went to */
export type LinkSource = "github" | "gist";

/**
 * Why an import from a link stopped, as New project's events count it.
 * `network` is GitHub unreachable, or answering with a refusal or a server
 * error, which the user can only retry; `unexpected` is anything else, a
 * fault of ours.
 */
export type LinkImportFailure =
  | "bad-link"
  | "not-found"
  | "rate-limited"
  | "too-large"
  | "no-program"
  | "invalid"
  | "network"
  | "unexpected";

/**
 * How an import from a link ended. A failure carries the message the card
 * shows, and the error behind it, if any, for the log. A link that is
 * neither a repository nor a gist has no source, nor has a throw that no
 * import answered.
 */
export type LinkImport =
  | { outcome: "imported"; source: LinkSource }
  | { outcome: "cancelled" }
  | {
      outcome: "failed";
      source: "unknown";
      reason: "bad-link" | "unexpected";
      message: string;
      error?: unknown;
    }
  | {
      outcome: "failed";
      source: LinkSource;
      reason: Exclude<LinkImportFailure, "bad-link">;
      message: string;
      error?: unknown;
    };
