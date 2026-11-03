import { createLogger } from "@/shared/lib/logger";
import {
  GITHUB_UNAUTHORIZED,
  MAX_DESCRIPTION,
  MAX_REQUEST_BYTES,
  NEEDS_GIST_SCOPE,
} from "../config.mjs";
import {
  MAX_GIST_BYTES,
  MAX_GIST_FILES,
  measureGist,
  toGistFiles,
} from "../lib/format";
import { parseGistRef, parseGistUrl } from "../lib/url";
import { gistTelemetry } from "./telemetry";
import type {
  GistExportFailure,
  GistShareSource,
  GistVisibility,
} from "./telemetry";

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
  | { status: "created"; url: string; id: string; files: number }
  | { status: "needs-sign-in" }
  | { status: "needs-gist-scope" }
  | { status: "failed"; reason: ExportFailure };

/** The route's `reason`, read only when it is a string */
const reasonOf = async (response: Response) => {
  try {
    const body = await response.json();
    return typeof body?.reason === "string" ? body.reason : undefined;
  } catch (e) {
    log.warn("gists answered no JSON", {
      context: { status: response.status, error: String(e) },
    });
    return undefined;
  }
};

/**
 * The created gist's id: the route's own, or else read from its URL. One a
 * Playground link (`/gist/<id>`) could not open counts as none.
 */
const idOf = (answer: { id?: unknown }, url: string) => {
  const id = typeof answer.id === "string" ? answer.id : parseGistUrl(url)?.id;
  return id && parseGistRef(id) ? id : undefined;
};

/**
 * Share a project as a gist once, secret or public as asked: flatten it,
 * check the limits, post it to `/api/gists`, and say what came of it.
 *
 * Sends `gist_export_started` and, on success, `gist_export_succeeded`. A
 * failure is the caller's to count: `needs-sign-in` and `needs-gist-scope`
 * are steps the dialog takes next, not ends, and only the dialog knows
 * whether one was the last.
 *
 * Never throws for an answer; a store that cannot be read throws from the
 * caller's `readFiles`, before this.
 *
 * `exportProjectWith(visibility)(source)(project)`: `visibility` says whether
 * the gist is listed on the user's profile, `source` where the share dialog
 * was opened (for telemetry), and `project` holds files keyed by path
 * relative to the project root.
 */
export const exportProjectWith =
  (visibility: GistVisibility) =>
  (source: GistShareSource) =>
  async (project: {
    name: string;
    files: Record<string, string>;
  }): Promise<ExportResult> => {
    const gist = toGistFiles(project);
    const size = measureGist(gist);
    gistTelemetry.track("gist_export_started", {
      files: size.files,
      visibility,
      source,
    });
    // The manifest is one more file against GitHub's limit
    if (size.bytes > MAX_GIST_BYTES || size.files + 1 > MAX_GIST_FILES) {
      return { status: "failed", reason: "too-large" };
    }
    const body = JSON.stringify({
      description: project.name.slice(0, MAX_DESCRIPTION),
      public: visibility === "public",
      files: gist,
    });
    if (new TextEncoder().encode(body).length > MAX_REQUEST_BYTES) {
      return { status: "failed", reason: "too-large" };
    }

    let response: Response;
    try {
      response = await fetch("/api/gists", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body,
      });
    } catch (e) {
      // Offline or blocked: the user's to retry, not the team's to hear of
      log.warn("gist request did not complete", {
        context: { error: String(e) },
      });
      return { status: "failed", reason: "request-failed" };
    }

    if (response.status === 201) {
      let answer: { url?: unknown; id?: unknown };
      try {
        answer = (await response.json()) ?? {};
      } catch (e) {
        // The gist may exist, but its address never arrived
        log.error(e, { report: true, context: { step: "read-created" } });
        return { status: "failed", reason: "request-failed" };
      }
      const { url } = answer;
      if (typeof url !== "string") {
        log.error(new Error("gists answered 201 without a url"), {
          report: true,
        });
        return { status: "failed", reason: "request-failed" };
      }
      const id = idOf(answer, url);
      if (!id) {
        // The gist exists, but no Playground link can open it
        log.error(new Error("gists answered 201 without a usable id"), {
          report: true,
        });
        return { status: "failed", reason: "request-failed" };
      }
      gistTelemetry.track("gist_export_succeeded", {
        files: size.files,
        visibility,
      });
      return { status: "created", url, id, files: size.files };
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
    if (response.status === 413)
      return { status: "failed", reason: "too-large" };
    if (response.status === 422)
      return { status: "failed", reason: "rejected" };

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

    const share = exportProjectWith("secret")("header");

    it("posts the flattened project and answers the gist's url and id", async () => {
      const fetch = answer(201, {
        url: "https://gist.github.com/a/b0",
        id: "b0",
      });

      const result = await share(PROJECT);

      expect(result).toEqual({
        status: "created",
        url: "https://gist.github.com/a/b0",
        id: "b0",
        files: 3,
      });
      const [url, init] = fetch.mock.calls[0];
      expect(url).toBe("/api/gists");
      const body = JSON.parse(init?.body as string);
      expect(body.description).toBe("counter");
      expect(body.public).toBe(false);
      expect(Object.keys(body.files).sort()).toEqual([
        ".playground.json",
        "README.md",
        "client__client.ts",
        "src__lib.rs",
      ]);
      expect(sent.events).toEqual([
        {
          name: "gist_export_started",
          params: { files: 3, visibility: "secret", source: "header" },
        },
        {
          name: "gist_export_succeeded",
          params: { files: 3, visibility: "secret" },
        },
      ]);
    });

    it("asks for a public gist when told to, and says where it started", async () => {
      const fetch = answer(201, {
        url: "https://gist.github.com/a/b0",
        id: "b0",
      });

      await exportProjectWith("public")("project_menu")(PROJECT);

      expect(JSON.parse(fetch.mock.calls[0][1]?.body as string).public).toBe(
        true
      );
      expect(sent.events[0]).toEqual({
        name: "gist_export_started",
        params: { files: 3, visibility: "public", source: "project_menu" },
      });
    });

    it("reads the id from the url when the answer has none", async () => {
      answer(201, { url: "https://gist.github.com/a/c0ffee" });

      expect(await share(PROJECT)).toEqual({
        status: "created",
        url: "https://gist.github.com/a/c0ffee",
        id: "c0ffee",
        files: 3,
      });
    });

    it("fails a 201 whose gist no Playground link could open", async () => {
      answer(201, { url: "https://example.com/not-a-gist" });

      expect(await share(PROJECT)).toEqual({
        status: "failed",
        reason: "request-failed",
      });
      expect(names()).toEqual(["gist_export_started"]);
    });

    it("refuses an oversized project without a request", async () => {
      const fetch = vi.spyOn(globalThis, "fetch");

      const result = await share({
        name: "big",
        files: { "a.rs": "é".repeat(MAX_GIST_BYTES / 2 + 1) },
      });

      expect(result).toEqual({ status: "failed", reason: "too-large" });
      expect(fetch).not.toHaveBeenCalled();
    });

    it("refuses a project whose JSON request would exceed Vercel's limit", async () => {
      const fetch = vi.spyOn(globalThis, "fetch");

      // 3 MB of content, but JSON writes each backslash as two
      const result = await share({
        name: "escaped",
        files: { "a.ts": `// ${"\\".repeat(3 * 1024 * 1024)}` },
      });

      expect(result).toEqual({ status: "failed", reason: "too-large" });
      expect(fetch).not.toHaveBeenCalled();
    });

    it("refuses a project of too many files without a request", async () => {
      const fetch = vi.spyOn(globalThis, "fetch");
      const files: Record<string, string> = {};
      // With the manifest, 300 project files make 301 gist files
      for (let i = 0; i < MAX_GIST_FILES; i++) files[`f${i}.rs`] = "x";

      const result = await share({ name: "many", files });

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
      // eslint-disable-next-line max-params -- `it.each` spreads each row of the table into the callback
    ])("maps a %i %j to %j", async (status, body, expected) => {
      answer(status, body);

      expect(await share(PROJECT)).toEqual(expected);
      expect(names()).toEqual(["gist_export_started"]);
    });

    it("fails a 201 that names no gist", async () => {
      answer(201, { id: "b" });

      expect(await share(PROJECT)).toEqual({
        status: "failed",
        reason: "request-failed",
      });
      expect(names()).toEqual(["gist_export_started"]);
    });

    it("cuts a long project name to the description's limit", async () => {
      const fetch = answer(201, { url: "https://gist.github.com/a/b" });

      await share({ name: "n".repeat(300), files: PROJECT.files });

      const body = JSON.parse(fetch.mock.calls[0][1]?.body as string);
      expect(body.description).toBe("n".repeat(200));
      expect(JSON.parse(body.files[".playground.json"].content).name).toBe(
        "n".repeat(300)
      );
    });

    it("says a request that never completed failed", async () => {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(
        new TypeError("Failed to fetch")
      );

      expect(await share(PROJECT)).toEqual({
        status: "failed",
        reason: "request-failed",
      });
    });

    it("sends no path, content or url in any event", async () => {
      answer(201, { url: "https://gist.github.com/a/b0", id: "b0" });

      await share(PROJECT);

      const all = JSON.stringify(sent.events);
      expect(all).not.toContain("lib.rs");
      expect(all).not.toContain("gist.github.com");
      expect(all).not.toContain("counter");
    });
  });
}
