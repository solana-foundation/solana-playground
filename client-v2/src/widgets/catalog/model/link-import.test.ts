const { mockImportGist, mockGithubImport } = vi.hoisted(() => ({
  mockImportGist: vi.fn(),
  mockGithubImport: vi.fn(),
}));

vi.mock("@/features/gist", async () => {
  const url = await vi.importActual<typeof import("@/features/gist/lib/url")>(
    "@/features/gist/lib/url"
  );
  class GistImportError extends Error {
    constructor(readonly reason: string, message: string) {
      super(message);
    }
  }
  class GistUnreachableError extends GistImportError {
    constructor(message: string) {
      super("request-failed", message);
    }
  }
  return {
    parseGistUrl: url.parseGistUrl,
    importGist: mockImportGist,
    GistImportError,
    GistUnreachableError,
  };
});

vi.mock("@/utils", () => {
  class ImportCancelledError extends Error {}
  class GithubImportError extends Error {
    constructor(message: string, readonly reason: string) {
      super(message);
    }
  }
  class GithubFileError extends GithubImportError {}
  class ConversionError extends Error {
    constructor(message: string, readonly reason: string) {
      super(message);
    }
  }
  return {
    ImportCancelledError,
    GithubImportError,
    GithubFileError,
    ConversionError,
    PgGithub: {
      isValidUrl: (url: string) =>
        /^(https:\/\/?)?(www\.)?github\.com\/.+?\/.+/.test(url),
      import: mockGithubImport,
      parseUrl: (url: string) => {
        const [owner = "", repo = ""] = url.split("github.com/")[1].split("/");
        return { owner, repo };
      },
    },
  };
});

import { GistImportError, GistUnreachableError } from "@/features/gist";
import type { ConversionReason, GithubImportReason } from "@/utils";
import {
  ConversionError,
  GithubFileError,
  GithubImportError,
  ImportCancelledError,
} from "@/utils";

import { BAD_LINK, importLink } from "./link-import";

const REPO = "https://github.com/alice/ts-client";
const GIST = "https://gist.github.com/alice/0123abcd";

beforeEach(() => {
  mockImportGist.mockReset().mockResolvedValue(undefined);
  mockGithubImport.mockReset().mockResolvedValue(undefined);
});

describe("importLink routes the link", () => {
  it("imports a repository link, trimmed", async () => {
    await expect(importLink(`  ${REPO} `)).resolves.toEqual({
      outcome: "imported",
      source: "github",
    });
    expect(mockGithubImport).toHaveBeenCalledWith(REPO);
    expect(mockImportGist).not.toHaveBeenCalled();
  });

  it("takes a repository link without its scheme", async () => {
    await expect(importLink("github.com/alice/ts-client")).resolves.toEqual({
      outcome: "imported",
      source: "github",
    });
  });

  it("sends a gist link to the gist import, from New project", async () => {
    await expect(importLink(GIST)).resolves.toEqual({
      outcome: "imported",
      source: "gist",
    });
    expect(mockImportGist).toHaveBeenCalledWith(GIST, "new-project");
    expect(mockGithubImport).not.toHaveBeenCalled();
  });

  it("runs one import at a time, the later after the earlier ends", async () => {
    let finish = () => {};
    mockGithubImport.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finish = resolve))
    );
    const first = importLink(REPO);
    const second = importLink(REPO);
    await Promise.resolve();
    await Promise.resolve();
    expect(mockGithubImport).toHaveBeenCalledTimes(1);

    finish();
    await expect(first).resolves.toEqual({
      outcome: "imported",
      source: "github",
    });
    await expect(second).resolves.toEqual({
      outcome: "imported",
      source: "github",
    });
    expect(mockGithubImport).toHaveBeenCalledTimes(2);
  });

  it("refuses a link that is neither, before any import", async () => {
    await expect(importLink("https://gitlab.com/acme/escrow")).resolves.toEqual(
      {
        outcome: "failed",
        source: "unknown",
        reason: "bad-link",
        message: BAD_LINK,
      }
    );
    expect(BAD_LINK).toBe("This isn't a GitHub repo or gist link.");
    expect(mockGithubImport).not.toHaveBeenCalled();
    expect(mockImportGist).not.toHaveBeenCalled();
  });
});

describe("importLink says why an import failed", () => {
  const failWith = (error: unknown) =>
    mockGithubImport.mockRejectedValueOnce(error);

  it("calls a closed program picker a cancel", async () => {
    failWith(new ImportCancelledError());
    await expect(importLink(REPO)).resolves.toEqual({ outcome: "cancelled" });
  });

  it("says a repository GitHub cannot find may be private", async () => {
    const error = new GithubImportError("not found", "not-found");
    failWith(error);
    await expect(
      importLink("https://github.com/acme/escrow-private")
    ).resolves.toEqual({
      outcome: "failed",
      source: "github",
      reason: "not-found",
      message:
        "Playground can't find acme/escrow-private on GitHub. It may be private, renamed or deleted.",
      error,
    });
  });

  it("keeps the message of a file GitHub cannot find", async () => {
    failWith(
      new GithubFileError('"src/lib.rs" was not found on GitHub.', "not-found")
    );
    await expect(importLink(REPO)).resolves.toMatchObject({
      outcome: "failed",
      reason: "not-found",
      message: '"src/lib.rs" was not found on GitHub.',
    });
  });

  it("keeps a gist import's own reason and message", async () => {
    mockImportGist.mockRejectedValueOnce(
      new GistImportError("rate-limited", "Gist limit.")
    );
    await expect(importLink(GIST)).resolves.toMatchObject({
      outcome: "failed",
      source: "gist",
      reason: "rate-limited",
      message: "Gist limit.",
    });
  });

  it.each<[GithubImportReason, string]>([
    ["rate-limited", "rate-limited"],
    ["too-large", "too-large"],
    ["no-source", "no-program"],
    ["other", "network"],
  ])("reads GitHub's %s as %s, showing its message", async (given, reason) => {
    failWith(new GithubImportError("GitHub said no.", given));
    await expect(importLink(REPO)).resolves.toMatchObject({
      outcome: "failed",
      source: "github",
      reason,
      message: "GitHub said no.",
    });
  });

  it.each<ConversionReason>(["unsupported", "no-source"])(
    "reads a %s conversion as no program, showing its message",
    async (given) => {
      failWith(new ConversionError("Not a program.", given));
      await expect(importLink(REPO)).resolves.toMatchObject({
        reason: "no-program",
        message: "Not a program.",
      });
    }
  );

  it("says GitHub could not be reached when the request never got an answer", async () => {
    failWith(new GithubImportError("GitHub did not answer.", "network"));
    await expect(importLink(REPO)).resolves.toMatchObject({
      outcome: "failed",
      reason: "network",
      message: "Could not reach GitHub. Check the connection and try again.",
    });
  });

  it("counts a gist request GitHub failed as network, keeping its message", async () => {
    mockImportGist.mockRejectedValueOnce(
      new GistImportError("request-failed", "Could not reach GitHub.")
    );
    await expect(importLink(GIST)).resolves.toMatchObject({
      reason: "network",
      message: "Could not reach GitHub.",
    });
  });

  it("says GitHub could not be reached when a gist request never got an answer", async () => {
    mockImportGist.mockRejectedValueOnce(
      new GistUnreachableError(
        'Could not reach GitHub to read Gist "a5". Check the connection and try again.'
      )
    );
    await expect(importLink(GIST)).resolves.toMatchObject({
      reason: "network",
      message: "Could not reach GitHub. Check the connection and try again.",
    });
  });

  it("counts a gist import's own fault as unexpected", async () => {
    mockImportGist.mockRejectedValueOnce(
      new GistImportError("unexpected", 'Could not import gist "a5".')
    );
    await expect(importLink(GIST)).resolves.toMatchObject({
      reason: "unexpected",
      message: 'Could not import gist "a5".',
    });
  });

  it("calls a TypeError unexpected: PgGithub names an unanswered request", async () => {
    failWith(new TypeError("Cannot read properties of undefined"));
    await expect(importLink(REPO)).resolves.toMatchObject({
      reason: "unexpected",
      message: "Cannot read properties of undefined",
    });
  });

  it("calls anything else unexpected, with its message", async () => {
    failWith(new Error("IndexedDB is closed"));
    await expect(importLink(REPO)).resolves.toMatchObject({
      reason: "unexpected",
      message: "IndexedDB is closed",
    });
  });

  it("gives a throw that is not an Error a message of its own", async () => {
    failWith("boom");
    await expect(importLink(REPO)).resolves.toMatchObject({
      outcome: "failed",
      reason: "unexpected",
      message: "Could not import it.",
    });
  });
});
