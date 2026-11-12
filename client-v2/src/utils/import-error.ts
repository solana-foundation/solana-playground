// Dependency-free, like `server-error.ts`: a slice reads these without
// booting the `utils` barrel.

/** Thrown when the user closes the program selection without choosing */
export class ImportCancelledError extends Error {
  constructor() {
    super("Import cancelled");
    this.name = "ImportCancelledError";
  }
}

/**
 * Why a GitHub import could not read the repository or one of its files, as
 * telemetry reports it; `network` is a request that got no answer
 */
export type GithubImportReason =
  | "not-found"
  | "rate-limited"
  | "too-large"
  | "no-source"
  | "network"
  | "other";

/**
 * A GitHub import failure with the reason telemetry reports; `message` is what
 * the user reads (spec `client-v2-project-files`, "Import failures carry an
 * enumerated reason")
 */
export class GithubImportError extends Error {
  constructor(message: string, readonly reason: GithubImportReason) {
    super(message);
    this.name = "GithubImportError";
  }
}

/** Why an import's files could not become a project, as telemetry reports it */
export type ConversionReason = "unsupported" | "no-source";

/**
 * An import refused or converted to nothing; `message` is what the user reads
 * (spec `client-v2-project-files`, "Import failures carry an enumerated
 * reason")
 */
export class ConversionError extends Error {
  constructor(message: string, readonly reason: ConversionReason) {
    super(message);
    this.name = "ConversionError";
  }
}
