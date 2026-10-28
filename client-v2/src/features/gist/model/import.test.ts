// `@types/mocha` also declares a global `it`, without `each`
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initLogger,
  memoryProvider as logMemory,
  resetLogger,
} from "@/shared/lib/logger";
import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";
import { getGistFiles, GistImportError, importGist } from "./import";

const utils = vi.hoisted(() => ({
  PgExplorer: {
    getAllWorkspaceNames: vi.fn(),
    createWorkspace: vi.fn(),
    switchWorkspace: vi.fn(),
  },
  PgFramework: { getFromFiles: vi.fn(), hasRunnableTypeScript: vi.fn() },
}));
vi.mock("@/utils", () => utils);

// The layout rules are the format module's and are tested there; here the
// format answers what each case needs
const format = vi.hoisted(() => {
  class GistFormatError extends Error {
    constructor(readonly reason: string, message: string) {
      super(message);
    }
  }
  return { fromGistFiles: vi.fn(), GistFormatError };
});
vi.mock("../lib/format", () => format);

const ID = "0123abcd";

/** A gist API answer */
const gist = (
  files: Record<string, { content?: string; truncated?: boolean }>,
  opts: { owner?: string | null; truncated?: boolean } = {}
) => ({
  files: Object.fromEntries(
    Object.entries(files).map(([name, file]) => [
      name,
      {
        content: file.content,
        truncated: file.truncated,
        raw_url: `https://gist.githubusercontent.com/raw/${name}`,
      },
    ])
  ),
  truncated: opts.truncated ?? false,
  owner: opts.owner === null ? null : { login: opts.owner ?? "alice" },
});

const ok = (body: unknown) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body));

const status = (code: number, headers: Record<string, string> = {}) =>
  new Response("", { status: code, headers });

/** `fetch` answers each URL from the map, in calls made */
const answers = (byUrl: Record<string, Response | Error>) =>
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const answer = byUrl[String(input)];
    if (!answer) throw new Error(`unexpected request ${String(input)}`);
    if (answer instanceof Error) throw answer;
    return answer;
  });

const API = `https://api.github.com/gists/${ID}`;
const LIB = "use anchor_lang::prelude::*;";

let sent: ReturnType<typeof memoryProvider>;

beforeEach(() => {
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
  utils.PgExplorer.getAllWorkspaceNames.mockReset().mockResolvedValue([]);
  utils.PgExplorer.createWorkspace.mockReset();
  utils.PgExplorer.switchWorkspace.mockReset();
  utils.PgFramework.getFromFiles.mockReset().mockResolvedValue({});
  utils.PgFramework.hasRunnableTypeScript.mockReset().mockReturnValue(false);
  format.fromGistFiles.mockReset().mockReturnValue({
    layout: "manifest",
    files: { "src/lib.rs": LIB },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  resetTelemetry();
  resetLogger();
});

const events = () => sent.events.map(({ name, params }) => ({ name, params }));

/** The failure an import ended with */
const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error as GistImportError;
  }
  throw new Error("the import did not fail");
};

describe("importGist", () => {
  it("creates gist-<owner>/<id> from the laid-out files", async () => {
    answers({ [API]: ok(gist({ "src-lib.rs": { content: LIB } })) });

    await importGist(`https://gist.github.com/alice/${ID}`, "dialog");

    expect(format.fromGistFiles).toHaveBeenCalledWith({
      "src-lib.rs": { content: LIB },
    });
    expect(utils.PgExplorer.createWorkspace).toHaveBeenCalledWith(
      `gist-alice/${ID}`,
      { files: [["src/lib.rs", LIB]], skipNameValidation: true }
    );
    expect(events()).toEqual([
      { name: "gist_import_started", params: { from: "dialog" } },
      {
        name: "gist_import_succeeded",
        params: { from: "dialog", layout: "manifest" },
      },
    ]);
  });

  it("reports a loose layout as the format placed it", async () => {
    answers({ [API]: ok(gist({ "lib.rs": { content: LIB } })) });
    format.fromGistFiles.mockReturnValue({
      layout: "loose",
      files: { "src/lib.rs": LIB },
    });

    await importGist(`https://gist.github.com/alice/${ID}`, "dialog");

    expect(events().at(-1)).toEqual({
      name: "gist_import_succeeded",
      params: { from: "dialog", layout: "loose" },
    });
  });

  it("opens the project of a gist already imported, without a request", async () => {
    const fetch = answers({});
    utils.PgExplorer.getAllWorkspaceNames.mockResolvedValue([
      `gist-alice/${ID}`,
    ]);

    await importGist(`https://gist.github.com/alice/${ID}`, "dialog");

    expect(fetch).not.toHaveBeenCalled();
    expect(utils.PgExplorer.switchWorkspace).toHaveBeenCalledWith(
      `gist-alice/${ID}`
    );
    expect(utils.PgExplorer.createWorkspace).not.toHaveBeenCalled();
  });

  it("opens an existing project once the API names the owner", async () => {
    answers({ [API]: ok(gist({ "lib.rs": { content: LIB } })) });
    utils.PgExplorer.getAllWorkspaceNames.mockResolvedValue([
      `gist-alice/${ID}`,
    ]);

    await importGist(`https://gist.github.com/${ID}`, "dialog");

    expect(utils.PgExplorer.switchWorkspace).toHaveBeenCalledWith(
      `gist-alice/${ID}`
    );
    expect(utils.PgExplorer.createWorkspace).not.toHaveBeenCalled();
  });

  it("opens a pinned revision imported before, without a request", async () => {
    const fetch = answers({});
    utils.PgExplorer.getAllWorkspaceNames.mockResolvedValue([
      `gist-alice/${ID}`,
      `gist-alice/${ID}@9f8e7d`,
    ]);

    await importGist(`https://gist.github.com/alice/${ID}/9f8e7d`, "dialog");

    expect(fetch).not.toHaveBeenCalled();
    expect(utils.PgExplorer.switchWorkspace).toHaveBeenCalledWith(
      `gist-alice/${ID}@9f8e7d`
    );
  });

  it("reads a pinned revision and names the project after it", async () => {
    answers({ [`${API}/9f8e7d`]: ok(gist({ "lib.rs": { content: LIB } })) });

    await importGist(`https://gist.github.com/alice/${ID}/9f8e7d`, "dialog");

    expect(utils.PgExplorer.createWorkspace).toHaveBeenCalledWith(
      `gist-alice/${ID}@9f8e7d`,
      expect.anything()
    );
  });

  it("names an anonymous gist's project gist-anonymous/<id>", async () => {
    answers({
      [API]: ok(gist({ "lib.rs": { content: LIB } }, { owner: null })),
    });

    await importGist(`https://gist.github.com/${ID}`, "dialog");

    expect(utils.PgExplorer.createWorkspace).toHaveBeenCalledWith(
      `gist-anonymous/${ID}`,
      expect.anything()
    );
  });

  it("refuses a URL that is not a gist's", async () => {
    const error = await failure(
      importGist("https://github.com/alice/repo", "dialog")
    );

    expect(error.reason).toBe("invalid");
    expect(utils.PgExplorer.createWorkspace).not.toHaveBeenCalled();
  });
});

describe("getGistFiles", () => {
  it("downloads a file the API cut short whole", async () => {
    answers({
      [API]: ok(gist({ "lib.rs": { content: "use anc", truncated: true } })),
      "https://gist.githubusercontent.com/raw/lib.rs": ok(LIB),
    });

    await getGistFiles({ id: ID }, "link");

    expect(format.fromGistFiles).toHaveBeenCalledWith({
      "lib.rs": { content: LIB },
    });
  });

  it.each<{
    title: string;
    answer: Response | Error;
    reason: string;
    message: RegExp;
  }>([
    {
      title: "a missing gist",
      answer: status(404),
      reason: "not-found",
      message: /not found.*link may be out of date/,
    },
    {
      title: "GitHub's hourly limit",
      answer: status(403, { "x-ratelimit-remaining": "0" }),
      reason: "rate-limited",
      message: /try again later/,
    },
    {
      title: "a refusal with requests left",
      answer: status(403, { "x-ratelimit-remaining": "12" }),
      reason: "request-failed",
      message: /refused.*status 403/,
    },
    {
      title: "a refusal with no limit header",
      answer: status(403),
      reason: "request-failed",
      message: /refused/,
    },
    {
      title: "GitHub's limit answered as 429",
      answer: status(429, { "x-ratelimit-remaining": "0" }),
      reason: "rate-limited",
      message: /try again later/,
    },
    {
      title: "an answer that is not JSON",
      answer: ok("<html>captive portal</html>"),
      reason: "request-failed",
      message: /not a gist/,
    },
    {
      title: "an answer with no files",
      answer: ok({ message: "moved" }),
      reason: "request-failed",
      message: /not a gist/,
    },
    {
      title: "a server error",
      answer: status(500),
      reason: "request-failed",
      message: /status 500/,
    },
    {
      title: "no answer at all",
      answer: new TypeError("Failed to fetch"),
      reason: "request-failed",
      message: /Could not reach GitHub/,
    },
  ])("names $title", async ({ answer, reason, message }) => {
    answers({ [API]: answer });

    const error = await failure(getGistFiles({ id: ID }, "link"));

    expect(error).toBeInstanceOf(GistImportError);
    expect(error.reason).toBe(reason);
    expect(error.message).toMatch(message);
    expect(events()).toEqual([
      { name: "gist_import_started", params: { from: "link" } },
      { name: "gist_import_failed", params: { from: "link", reason } },
    ]);
  });

  it("downloads a file the API gave no content for", async () => {
    answers({
      [API]: ok(gist({ "lib.rs": {} })),
      "https://gist.githubusercontent.com/raw/lib.rs": ok(LIB),
    });

    await getGistFiles({ id: ID }, "link");

    expect(format.fromGistFiles).toHaveBeenCalledWith({
      "lib.rs": { content: LIB },
    });
  });

  it("skips a file the API answers as null", async () => {
    const answer = gist({ "lib.rs": { content: LIB } });
    answers({
      [API]: ok({
        truncated: answer.truncated,
        owner: answer.owner,
        files: { "lib.rs": answer.files["lib.rs"], "gone.rs": null },
      }),
    });

    await getGistFiles({ id: ID }, "link");

    expect(format.fromGistFiles).toHaveBeenCalledWith({
      "lib.rs": { content: LIB },
    });
  });

  it("names the file whose whole download failed", async () => {
    answers({
      [API]: ok(gist({ "lib.rs": { content: "use anc", truncated: true } })),
      "https://gist.githubusercontent.com/raw/lib.rs": status(404),
    });

    const error = await failure(getGistFiles({ id: ID }, "link"));

    expect(error.reason).toBe("not-found");
    expect(error.message).toMatch(/"lib\.rs" was not found/);
    expect(format.fromGistFiles).not.toHaveBeenCalled();
  });

  it("refuses a gist GitHub lists only part of", async () => {
    answers({ [API]: ok(gist({}, { truncated: true })) });

    const error = await failure(getGistFiles({ id: ID }, "link"));

    expect(error.reason).toBe("too-large");
    expect(format.fromGistFiles).not.toHaveBeenCalled();
  });

  it("names an invalid manifest", async () => {
    answers({ [API]: ok(gist({ ".playground.json": { content: "{}" } })) });
    format.fromGistFiles.mockImplementation(() => {
      throw new format.GistFormatError(
        "unsafe-path",
        "Refusing to write ../x.rs."
      );
    });

    const error = await failure(getGistFiles({ id: ID }, "dialog"));

    expect(error.reason).toBe("invalid");
    expect(error.message).toMatch(/manifest is invalid: Refusing to write/);
  });

  it("says a gist from a newer Playground is newer, not broken", async () => {
    answers({ [API]: ok(gist({ ".playground.json": { content: "{}" } })) });
    format.fromGistFiles.mockImplementation(() => {
      throw new format.GistFormatError(
        "unsupported-version",
        "This gist was made by a newer Playground (format 2)."
      );
    });

    const error = await failure(getGistFiles({ id: ID }, "dialog"));

    expect(error.reason).toBe("invalid");
    expect(error.message).toBe(
      "This gist was made by a newer Playground (format 2)."
    );
  });

  it("counts a fault of ours as a failed request and reports it", async () => {
    const logs = logMemory();
    initLogger({ providers: [logs] });
    answers({ [API]: ok(gist({ "lib.rs": { content: LIB } })) });
    format.fromGistFiles.mockImplementation(() => {
      throw new TypeError("boom");
    });

    const error = await failure(getGistFiles({ id: ID }, "dialog"));

    expect(error.reason).toBe("request-failed");
    expect(error.message).toBe(`Could not import gist "${ID}".`);
    expect(error.cause).toBeInstanceOf(TypeError);
    expect(
      logs.entries.map(({ level, report }) => ({ level, report }))
    ).toEqual([{ level: "error", report: true }]);
    expect(events().at(-1)).toEqual({
      name: "gist_import_failed",
      params: { from: "dialog", reason: "request-failed" },
    });
  });

  it("refuses a gist with no usable file", async () => {
    answers({ [API]: ok(gist({ "notes.txt": { content: "hi" } })) });
    format.fromGistFiles.mockImplementation(() => {
      throw new format.GistFormatError(
        "no-supported-files",
        "This gist holds no file the Playground can open."
      );
    });

    const error = await failure(getGistFiles({ id: ID }, "dialog"));

    expect(error.reason).toBe("no-program");
    expect(utils.PgFramework.getFromFiles).not.toHaveBeenCalled();
  });

  it("opens a hand-made gist of TypeScript with no program", async () => {
    answers({
      [API]: ok(
        gist({
          "client.ts": { content: "x" },
          "client.test.ts": { content: "y" },
        })
      ),
    });
    format.fromGistFiles.mockReturnValue({
      layout: "loose",
      files: { "client/client.ts": "x", "tests/client.test.ts": "y" },
    });
    utils.PgFramework.getFromFiles.mockResolvedValue(undefined);
    utils.PgFramework.hasRunnableTypeScript.mockReturnValue(true);

    const result = await getGistFiles({ id: ID }, "dialog");

    expect(result.files).toEqual([
      ["client/client.ts", "x"],
      ["tests/client.test.ts", "y"],
    ]);
    expect(utils.PgFramework.hasRunnableTypeScript).toHaveBeenCalledWith([
      "client/client.ts",
      "tests/client.test.ts",
    ]);
    expect(events().at(-1)).toEqual({
      name: "gist_import_succeeded",
      params: { from: "dialog", layout: "loose" },
    });
  });

  it("refuses a gist with neither a program nor a script", async () => {
    answers({ [API]: ok(gist({ "notes.md": { content: "x" } })) });
    format.fromGistFiles.mockReturnValue({
      layout: "loose",
      files: { "notes.md": "x" },
    });
    utils.PgFramework.getFromFiles.mockResolvedValue(undefined);
    utils.PgFramework.hasRunnableTypeScript.mockReturnValue(false);

    const error = await failure(getGistFiles({ id: ID }, "dialog"));

    expect(error.reason).toBe("no-program");
    expect(error.message).toBe(
      "This gist holds no Solana program and no TypeScript or JavaScript to open."
    );
    expect(events().at(-1)).toEqual({
      name: "gist_import_failed",
      params: { from: "dialog", reason: "no-program" },
    });
  });
});
