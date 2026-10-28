import { PgExplorer, PgFramework } from "@/utils";
import type { TupleFiles } from "@/utils";
import { createLogger } from "@/shared/lib/logger";
import { fromGistFiles, GistFormatError } from "../lib/format";
import { parseGistUrl } from "../lib/url";
import type { GistRef } from "../lib/url";
import { gistTelemetry } from "./telemetry";
import type { GistImportFailure, GistImportSource } from "./telemetry";

const log = createLogger("gist:import");

/** Owner of a gist made without an account */
const ANONYMOUS_OWNER = "anonymous";

/** One file of a gist, as the gist API answers it */
type GistApiFile = {
  /** Content, cut at about 1 MB when `truncated` */
  content?: string;
  /** Whether `content` is cut short */
  truncated?: boolean;
  /**
   * Where the whole content can be downloaded; taken as GitHub's own, as the
   * rest of the answer is
   */
  raw_url: string;
};

/** A gist, as the gist API answers it */
type GistApiResponse = {
  files: Record<string, GistApiFile | null>;
  /** Whether GitHub left files out because the gist holds too many */
  truncated?: boolean;
  owner?: { login: string } | null;
};

/** An import that stopped, with the reason the user was told */
export class GistImportError extends Error {
  constructor(
    readonly reason: GistImportFailure,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "GistImportError";
  }
}

/**
 * Turn a failed response into a message that explains what to do next,
 * modelled on repository import's (`PgGithub`). A missing gist says "may have
 * been deleted" where a repository says "may be private": a secret gist is
 * readable by anyone holding its URL, so private is never the reason.
 *
 * @param response failed response
 * @param subject the gist or file the request was about
 * @returns the failure
 */
const responseError = (response: Response, subject: string) => {
  switch (response.status) {
    case 403:
    case 429:
      if (response.headers.get("x-ratelimit-remaining") === "0") {
        return new GistImportError(
          "rate-limited",
          "GitHub's hourly request limit for this browser has been reached. " +
            "Please try again later."
        );
      }
      return new GistImportError(
        "request-failed",
        `GitHub refused the request for ${subject} (status ` +
          `${response.status}). Please try again later.`
      );

    case 404:
      return new GistImportError(
        "not-found",
        `${subject} was not found on GitHub. It may have been deleted or the ` +
          "link may be out of date."
      );

    default:
      return new GistImportError(
        "request-failed",
        `GitHub request for ${subject} failed with status ${response.status}.`
      );
  }
};

/**
 * Fetch, turning a request that never got an answer, and one answered with a
 * failure status, into an import failure.
 *
 * @param url URL to fetch
 * @param subject the gist or file the request is about
 * @returns the successful response
 */
const request = async (url: string, subject: string) => {
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    log.warn(`request for ${subject} failed`, { context: { url, error } });
    throw new GistImportError(
      "request-failed",
      `Could not reach GitHub to read ${subject}. Check the connection and ` +
        "try again.",
      { cause: error }
    );
  }
  if (!response.ok) throw responseError(response, subject);
  return response;
};

/**
 * Read the gist API's answer, refusing one that is not a gist: a proxy's or
 * a captive portal's page, or a body cut short.
 *
 * @param response successful response of the gist API
 * @param subject the gist the request was about
 * @returns the gist
 */
const readAnswer = async (response: Response, subject: string) => {
  const unexpected = (cause?: unknown) =>
    new GistImportError(
      "request-failed",
      `GitHub answered the request for ${subject} with something that is ` +
        "not a gist. Please try again.",
      { cause }
    );

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    log.warn(`answer for ${subject} is not JSON`, { context: { error } });
    throw unexpected(error);
  }

  const files = (body as Partial<GistApiResponse> | null)?.files;
  if (typeof files !== "object" || files === null) throw unexpected();
  return body as GistApiResponse;
};

/**
 * Read a gist's files, downloading whole any file the API cut short.
 *
 * @param ref the gist
 * @returns the gist's owner and each file's whole content by name
 */
const readGist = async (ref: GistRef) => {
  const subject = `Gist "${ref.id}"`;
  const path = ref.revision ? `${ref.id}/${ref.revision}` : ref.id;
  const response = await request(
    `https://api.github.com/gists/${path}`,
    subject
  );
  const gist = await readAnswer(response, subject);
  if (gist.truncated) {
    throw new GistImportError(
      "too-large",
      `${subject} has too many files to import: GitHub only lists part of ` +
        "them."
    );
  }

  const files: Record<string, { content: string }> = {};
  for (const [name, file] of Object.entries(gist.files)) {
    // The API answers `null` for a file it cannot show; there is nothing to
    // import from it
    if (!file) continue;
    const content =
      file.truncated || file.content === undefined
        ? await (await request(file.raw_url, `"${name}"`)).text()
        : file.content;
    files[name] = { content };
  }

  return { owner: gist.owner?.login ?? ANONYMOUS_OWNER, files };
};

/**
 * Lay a gist's files out as a project's.
 *
 * @param files each file's content by gist file name
 * @returns the project's files and which rule placed them
 */
const layOut = async (files: Record<string, { content: string }>) => {
  let laidOut: ReturnType<typeof fromGistFiles>;
  try {
    laidOut = fromGistFiles(files);
  } catch (error) {
    if (!(error instanceof GistFormatError)) throw error;
    switch (error.reason) {
      // A gist of nothing the Playground opens holds no program either
      case "no-supported-files":
        throw new GistImportError("no-program", error.message, {
          cause: error,
        });
      // Not broken, only newer: the message says so on its own
      case "unsupported-version":
        throw new GistImportError("invalid", error.message, { cause: error });
      case "invalid-manifest":
      case "unsafe-path":
      case "missing-file":
        throw new GistImportError(
          "invalid",
          `This gist's Playground manifest is invalid: ${error.message}`,
          { cause: error }
        );
    }
  }

  const tupleFiles: TupleFiles = Object.entries(laidOut.files);
  if (!tupleFiles.length || !(await PgFramework.getFromFiles(tupleFiles))) {
    throw new GistImportError(
      "no-program",
      "No Solana program was found in this gist."
    );
  }

  return { layout: laidOut.layout, files: tupleFiles };
};

/**
 * Get a gist's files in a project's layout. Sends `gist_import_started`, then
 * `gist_import_succeeded` once the files are read and laid out, or
 * `gist_import_failed`; creating or opening the project is the caller's.
 *
 * @param ref the gist
 * @param from where the import started
 * @returns the gist's owner and the project's files
 * @throws {GistImportError} with the reason the import stopped
 */
export const getGistFiles = async (ref: GistRef, from: GistImportSource) => {
  gistTelemetry.track("gist_import_started", { from });
  try {
    const { owner, files } = await readGist(ref);
    const laidOut = await layOut(files);
    gistTelemetry.track("gist_import_succeeded", {
      from,
      layout: laidOut.layout,
    });
    return { owner, files: laidOut.files };
  } catch (error) {
    // Anything else is a fault of ours, not of the gist: reported, and
    // counted with the failed requests since the user can only retry
    const failure =
      error instanceof GistImportError
        ? error
        : new GistImportError(
            "request-failed",
            `Could not import gist "${ref.id}".`,
            { cause: error }
          );
    if (failure !== error) {
      log.error(error as Error, { report: true, context: { id: ref.id } });
    }
    gistTelemetry.track("gist_import_failed", { from, reason: failure.reason });
    throw failure;
  }
};

/**
 * Name of the project a gist imports as: `gist-<owner>/<id>`, with
 * `@<revision>` when the URL pins one so a pinned revision never opens over
 * the latest copy.
 */
const projectName = (owner: string, ref: GistRef) =>
  `gist-${owner}/${ref.id}` + (ref.revision ? `@${ref.revision}` : "");

/**
 * Import a gist as a saved project and open it. A gist already imported
 * opens its project instead, as a repository imported twice does.
 *
 * @param url gist URL
 * @param from where the import started
 * @throws {GistImportError} with the reason the import stopped
 */
export const importGist = async (url: string, from: GistImportSource) => {
  const ref = parseGistUrl(url);
  if (!ref) {
    throw new GistImportError("invalid", `"${url}" is not a gist URL.`);
  }

  // Read from the store: a gist link's temporary view holds no list
  const names = await PgExplorer.getAllWorkspaceNames();

  // The owner is known before any request only when the URL names it; then a
  // gist imported before opens without spending one of GitHub's 60 requests
  // an hour
  const knownName = ref.owner && projectName(ref.owner, ref);
  if (knownName && names.includes(knownName)) {
    await PgExplorer.switchWorkspace(knownName);
    return;
  }

  const { owner, files } = await getGistFiles(ref, from);
  const name = projectName(owner, ref);
  if (names.includes(name)) {
    await PgExplorer.switchWorkspace(name);
    return;
  }

  await PgExplorer.createWorkspace(name, { files, skipNameValidation: true });
};
