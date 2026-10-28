import { createLogger } from "@/shared/lib/logger";
import {
  GITHUB_UNAUTHORIZED,
  MAX_DESCRIPTION,
  NEEDS_GIST_SCOPE,
} from "../config.mjs";
import {
  MAX_GIST_BYTES,
  MAX_GIST_FILES,
  measureGist,
  toGistFiles,
} from "../lib/format";
import { gistTelemetry } from "./telemetry";
import type { GistExportFailure } from "./telemetry";

const log = createLogger("gist:export");

/** A failure the export ends on; the rest are steps the dialog takes next */
export type ExportFailure = Extract<
  GistExportFailure,
  | "too-large"
  | "github-unauthorized"
  | "rate-limited"
  | "rejected"
  | "request-failed"
>;

/** What one attempt at an export came to */
export type ExportResult =
  | { status: "created"; url: string; files: number }
  | { status: "needs-sign-in" }
  | { status: "needs-gist-scope" }
  | { status: "failed"; reason: ExportFailure };

/** The route's `reason`, read only when it is a string */
const reasonOf = async (response: Response) => {
  try {
    const body = await response.json();
    return typeof body?.reason === "string" ? body.reason : null;
  } catch (e) {
    log.warn("gists answered no JSON", {
      context: { status: response.status, error: String(e) },
    });
    return null;
  }
};

/**
 * Share a project as a public gist once: flatten it, check the limits, post
 * it to `/api/gists`, and say what came of it.
 *
 * Sends `gist_export_started` and, on success, `gist_export_succeeded`. A
 * failure is the caller's to count: `needs-sign-in` and `needs-gist-scope`
 * are steps the dialog takes next, not ends, and only the dialog knows
 * whether one was the last.
 *
 * Never throws for an answer; a store that cannot be read throws from the
 * caller's `readFiles`, before this.
 *
 * @param project files keyed by path relative to the project root
 */
export const exportProject = async (project: {
  name: string;
  files: Record<string, string>;
}): Promise<ExportResult> => {
  const gist = toGistFiles(project);
  const size = measureGist(gist);
  gistTelemetry.track("gist_export_started", { files: size.files });
  if (size.bytes > MAX_GIST_BYTES || size.files > MAX_GIST_FILES) {
    return { status: "failed", reason: "too-large" };
  }

  let response: Response;
  try {
    response = await fetch("/api/gists", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        description: project.name.slice(0, MAX_DESCRIPTION),
        files: gist,
      }),
    });
  } catch (e) {
    // Offline or blocked: the user's to retry, not the team's to hear of
    log.warn("gist request did not complete", {
      context: { error: String(e) },
    });
    return { status: "failed", reason: "request-failed" };
  }

  if (response.status === 201) {
    let url: unknown;
    try {
      ({ url } = await response.json());
    } catch (e) {
      // The gist may exist, but its address never arrived
      log.error(e, { report: true, context: { step: "read-created" } });
      return { status: "failed", reason: "request-failed" };
    }
    if (typeof url !== "string") {
      log.error(new Error("gists answered 201 without a url"), {
        report: true,
      });
      return { status: "failed", reason: "request-failed" };
    }
    gistTelemetry.track("gist_export_succeeded", { files: size.files });
    return { status: "created", url, files: size.files };
  }

  const reason = await reasonOf(response);
  if (response.status === 401) {
    // Any other 401 is our own session gone (`reason: "signed-out"`, auth's
    // `SIGNED_OUT_REASON`, which this feature may not import): sign in again
    if (reason === GITHUB_UNAUTHORIZED) {
      return { status: "failed", reason: "github-unauthorized" };
    }
    return { status: "needs-sign-in" };
  }
  if (response.status === 403 && reason === NEEDS_GIST_SCOPE) {
    return { status: "needs-gist-scope" };
  }
  if (response.status === 429) {
    return { status: "failed", reason: "rate-limited" };
  }
  if (response.status === 413) return { status: "failed", reason: "too-large" };
  if (response.status === 422) return { status: "failed", reason: "rejected" };

  // A 403 from the origin check, a 400, a 5xx: none is the user's doing
  log.error(new Error(`gists answered ${response.status}`), {
    report: true,
    context: { status: response.status, reason },
  });
  return { status: "failed", reason: "request-failed" };
};

if (import.meta.vitest) {
  const { describe, it, expect, vi, beforeAll, beforeEach, afterEach } =
    import.meta.vitest;

  describe("features/gist/model/export", () => {
    let telemetry: typeof import("@/shared/lib/telemetry");
    let sent: ReturnType<
      typeof import("@/shared/lib/telemetry").memoryProvider
    >;
    beforeAll(async () => {
      telemetry = await import("@/shared/lib/telemetry");
    });
    beforeEach(() => {
      sent = telemetry.memoryProvider();
      telemetry.initTelemetry({ providers: [sent] });
    });
    afterEach(() => {
      vi.restoreAllMocks();
      telemetry.resetTelemetry();
    });

    const PROJECT = {
      name: "counter",
      files: { "src/lib.rs": "a", "client/client.ts": "b", "README.md": "c" },
    };

    const answer = (status: number, body: unknown) =>
      vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          new Response(JSON.stringify(body), { status }) as Response
        );

    const names = () => sent.events.map((event) => event.name);

    it("posts the flattened project and answers the gist's url", async () => {
      const fetch = answer(201, {
        url: "https://gist.github.com/a/b",
        id: "b",
      });

      const result = await exportProject(PROJECT);

      expect(result).toEqual({
        status: "created",
        url: "https://gist.github.com/a/b",
        files: 3,
      });
      const [url, init] = fetch.mock.calls[0];
      expect(url).toBe("/api/gists");
      const body = JSON.parse(init!.body as string);
      expect(body.description).toBe("counter");
      expect(Object.keys(body.files).sort()).toEqual([
        ".playground.json",
        "README.md",
        "client__client.ts",
        "src__lib.rs",
      ]);
      expect(sent.events).toEqual([
        { name: "gist_export_started", params: { files: 3 } },
        { name: "gist_export_succeeded", params: { files: 3 } },
      ]);
    });

    it("refuses an oversized project without a request", async () => {
      const fetch = vi.spyOn(globalThis, "fetch");

      const result = await exportProject({
        name: "big",
        files: { "a.rs": "é".repeat(MAX_GIST_BYTES / 2 + 1) },
      });

      expect(result).toEqual({ status: "failed", reason: "too-large" });
      expect(fetch).not.toHaveBeenCalled();
    });

    it("refuses a project of too many files without a request", async () => {
      const fetch = vi.spyOn(globalThis, "fetch");
      const files: Record<string, string> = {};
      for (let i = 0; i <= MAX_GIST_FILES; i++) files[`f${i}.rs`] = "x";

      const result = await exportProject({ name: "many", files });

      expect(result).toEqual({ status: "failed", reason: "too-large" });
      expect(fetch).not.toHaveBeenCalled();
    });

    it.each([
      [401, { reason: "signed-out" }, { status: "needs-sign-in" }],
      [
        401,
        { reason: "github-unauthorized" },
        { status: "failed", reason: "github-unauthorized" },
      ],
      [403, { reason: "needs-gist-scope" }, { status: "needs-gist-scope" }],
      [
        429,
        { reason: "rate-limited" },
        { status: "failed", reason: "rate-limited" },
      ],
      [413, {}, { status: "failed", reason: "too-large" }],
      [422, { reason: "rejected" }, { status: "failed", reason: "rejected" }],
      [
        502,
        { reason: "request-failed" },
        { status: "failed", reason: "request-failed" },
      ],
      [
        403,
        { error: "Cross-origin request refused" },
        { status: "failed", reason: "request-failed" },
      ],
      [503, {}, { status: "failed", reason: "request-failed" }],
    ])("maps a %i %j to %j", async (status, body, expected) => {
      answer(status, body);

      expect(await exportProject(PROJECT)).toEqual(expected);
      expect(names()).toEqual(["gist_export_started"]);
    });

    it("fails a 201 that names no gist", async () => {
      answer(201, { id: "b" });

      expect(await exportProject(PROJECT)).toEqual({
        status: "failed",
        reason: "request-failed",
      });
      expect(names()).toEqual(["gist_export_started"]);
    });

    it("cuts a long project name to the description's limit", async () => {
      const fetch = answer(201, { url: "https://gist.github.com/a/b" });

      await exportProject({ name: "n".repeat(300), files: PROJECT.files });

      const body = JSON.parse(fetch.mock.calls[0][1]!.body as string);
      expect(body.description).toBe("n".repeat(200));
      expect(JSON.parse(body.files[".playground.json"].content).name).toBe(
        "n".repeat(300)
      );
    });

    it("says a request that never completed failed", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(
        new TypeError("Failed to fetch")
      );

      expect(await exportProject(PROJECT)).toEqual({
        status: "failed",
        reason: "request-failed",
      });
    });

    it("sends no path, content or url in any event", async () => {
      answer(201, { url: "https://gist.github.com/a/b" });

      await exportProject(PROJECT);

      const all = JSON.stringify(sent.events);
      expect(all).not.toContain("lib.rs");
      expect(all).not.toContain("gist.github.com");
      expect(all).not.toContain("counter");
    });
  });
}
