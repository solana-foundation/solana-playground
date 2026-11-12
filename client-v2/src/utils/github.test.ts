import { PgFramework } from "./framework";
import type { ImportProgress } from "./github";
import { filterRepoFiles, PgGithub } from "./github";
import { ImportCancelledError } from "./import-error";

// `./explorer` boots lightning-fs on import, which needs a real IndexedDB.
vi.mock("./explorer", () => ({ PgExplorer: {} }));

vi.mock("./framework", () => ({
  noProgramCode: (source: string) => `No program code found in ${source}.`,
  PgFramework: {
    // The middle step is a mock too, so a test can read the `source` it got
    convertToPlaygroundLayoutWith: vi.fn(() =>
      vi.fn(() => (files: unknown) => files)
    ),
  },
}));

const mockSetModal = vi.fn();
vi.mock("./view", () => ({
  PgView: { setModal: (...args: unknown[]) => mockSetModal(...args) },
}));
vi.mock("../frameworks/SelectProgram", () => ({
  SelectProgram: "SelectProgram",
}));

// Mirrors the extensions of the languages the app ships with.
vi.mock("./language", () => ({
  PgLanguage: {
    getFromPath: (path: string) =>
      /\.(rs|ts|js|json|py)$/.test(path) ? { name: "Mock" } : undefined,
  },
}));

const blob = (path: string) => ({ path, type: "blob", sha: path });
const tree = (path: string) => ({ path, type: "tree", sha: path });

describe("filterRepoFiles", () => {
  it("keeps only blobs written in a supported language", () => {
    const files = filterRepoFiles(
      [blob("src/lib.rs"), blob("Cargo.toml"), blob("logo.png"), tree("src")],
      ""
    );
    expect(files.map((f) => f.path)).toEqual(["src/lib.rs"]);
  });

  it("only matches the given path on segment boundaries", () => {
    const files = filterRepoFiles(
      [
        blob("token/program/src/lib.rs"),
        blob("token/program-2022/src/lib.rs"),
        blob("stake/program/src/lib.rs"),
      ],
      "token/program"
    );
    expect(files.map((f) => f.path)).toEqual(["token/program/src/lib.rs"]);
  });

  it("matches the path itself when it points to a file", () => {
    const files = filterRepoFiles([blob("src/lib.rs")], "src/lib.rs");
    expect(files.map((f) => f.path)).toEqual(["src/lib.rs"]);
  });

  it("ignores surrounding slashes in the path", () => {
    const files = filterRepoFiles([blob("src/lib.rs")], "/src/");
    expect(files.map((f) => f.path)).toEqual(["src/lib.rs"]);
  });

  it("skips directories that never hold program source", () => {
    const files = filterRepoFiles(
      [
        blob("src/lib.rs"),
        blob("node_modules/pkg/index.js"),
        blob("target/debug/build.rs"),
        blob(".github/workflows/ci.js"),
        blob("app/dist/bundle.js"),
      ],
      ""
    );
    expect(files.map((f) => f.path)).toEqual(["src/lib.rs"]);
  });

  it("skips lock files that happen to be JSON", () => {
    const files = filterRepoFiles(
      [blob("package.json"), blob("package-lock.json")],
      ""
    );
    expect(files.map((f) => f.path)).toEqual(["package.json"]);
  });
});

describe("PgGithub.getFiles", () => {
  type MockResponse = {
    status?: number;
    headers?: Record<string, string>;
    body: unknown;
  };

  const mockFetch = (handle: (url: string) => MockResponse) => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const { status = 200, headers, body } = handle(input.toString());
      const payload = typeof body === "string" ? body : JSON.stringify(body);
      return new Response(payload, { status, headers });
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  };

  beforeEach(() => mockSetModal.mockReset());

  const treeResponse = (paths: string[], truncated = false) => ({
    body: { truncated, tree: paths.map(blob) },
  });

  it("reads the layout from one tree request and keeps file order", async () => {
    const fetchMock = mockFetch((url) => {
      if (url.startsWith("https://api.github.com/")) {
        return treeResponse([
          "program/src/lib.rs",
          "program/tests/program.test.ts",
          "program/logo.png",
          "other/src/lib.rs",
        ]);
      }
      return { body: `content of ${url.split("/").pop()}` };
    });

    const files = await PgGithub.getFiles(
      "https://github.com/solana-labs/example/tree/master/program"
    );

    expect(files).toEqual([
      ["program/src/lib.rs", "content of lib.rs"],
      ["program/tests/program.test.ts", "content of program.test.ts"],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.github.com/repos/solana-labs/example/git/trees/master" +
        "?recursive=1"
    );
  });

  it("hands the imported folder and where it came from to the layout", async () => {
    mockFetch((url) =>
      url.startsWith("https://api.github.com/")
        ? treeResponse(["program/client.ts"])
        : { body: "x" }
    );

    await PgGithub.getFiles(
      "https://github.com/solana-labs/example/tree/master/program"
    );

    const convertWith = vi.mocked(PgFramework.convertToPlaygroundLayoutWith);
    expect(convertWith).toHaveBeenLastCalledWith("program");
    expect(convertWith.mock.results.at(-1)?.value).toHaveBeenLastCalledWith(
      "program in solana-labs/example"
    );
  });

  it("reports progress from the layout request to the last file", async () => {
    mockFetch((url) => {
      if (url.startsWith("https://api.github.com/")) {
        return treeResponse(["a.rs", "b.rs", "c.rs"]);
      }
      return { body: "content" };
    });

    const progress: ImportProgress[] = [];
    await PgGithub.getFiles("https://github.com/solana-labs/example", (next) =>
      progress.push(next)
    );

    expect(progress).toEqual([
      { loaded: 0, total: null },
      { loaded: 0, total: 3 },
      { loaded: 1, total: 3 },
      { loaded: 2, total: 3 },
      { loaded: 3, total: 3 },
    ]);
  });

  it("falls back to HEAD when the URL has no ref", async () => {
    const fetchMock = mockFetch((url) => {
      if (url.startsWith("https://api.github.com/")) {
        return treeResponse(["src/lib.rs"]);
      }
      return { body: "content" };
    });

    await PgGithub.getFiles("https://github.com/coral-xyz/xnft");

    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.github.com/repos/coral-xyz/xnft/git/trees/HEAD?recursive=1"
    );
    expect(fetchMock.mock.calls[1][0]).toBe(
      "https://raw.githubusercontent.com/coral-xyz/xnft/HEAD/src/lib.rs"
    );
  });

  it("explains that the request limit has been reached", async () => {
    mockFetch(() => ({
      status: 403,
      headers: { "x-ratelimit-remaining": "0" },
      body: { message: "API rate limit exceeded" },
    }));

    await expect(
      PgGithub.getFiles("https://github.com/solana-labs/example")
    ).rejects.toMatchObject({
      message: expect.stringMatching(/hourly request limit/),
      reason: "rate-limited",
    });
  });

  it("explains that the repository was not found", async () => {
    mockFetch(() => ({ status: 404, body: { message: "Not Found" } }));

    await expect(
      PgGithub.getFiles("https://github.com/solana-labs/example")
    ).rejects.toMatchObject({
      message: expect.stringMatching(/was not found on GitHub/),
      reason: "not-found",
      name: "GithubImportError",
    });
  });

  it("refuses to import a partially listed repository", async () => {
    mockFetch(() => treeResponse(["src/lib.rs"], true));

    await expect(
      PgGithub.getFiles("https://github.com/solana-labs/example")
    ).rejects.toMatchObject({
      message: expect.stringMatching(/too large to import/),
      reason: "too-large",
    });
  });

  it("reports a path that holds no program code", async () => {
    mockFetch(() => treeResponse(["docs/logo.png"]));

    await expect(
      PgGithub.getFiles(
        "https://github.com/solana-labs/example/tree/master/docs"
      )
    ).rejects.toMatchObject({
      message: "No program code found in docs in solana-labs/example.",
      reason: "no-source",
    });
  });

  it("reports a request that got no answer as a network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new TypeError("Failed to fetch")
    );

    await expect(
      PgGithub.getFiles("https://github.com/solana-labs/example")
    ).rejects.toMatchObject({
      message: expect.stringMatching(/did not answer/),
      reason: "network",
    });
  });

  it.each([
    ["a refusal that is not the hourly limit", { status: 403, body: "" }],
    ["a server error", { status: 500, body: "" }],
  ])("reports %s as other", async (_, response) => {
    mockFetch(() => response);

    await expect(
      PgGithub.getFiles("https://github.com/solana-labs/example")
    ).rejects.toMatchObject({ reason: "other" });
  });

  it("asks which program to import before downloading anything", async () => {
    const fetchMock = mockFetch((url) => {
      if (url.startsWith("https://api.github.com/")) {
        return treeResponse([
          "programs/alpha/src/lib.rs",
          "programs/alpha/src/state.rs",
          "programs/beta/src/lib.rs",
          "tests/shared.ts",
        ]);
      }
      return { body: "content" };
    });
    mockSetModal.mockResolvedValueOnce("alpha");

    const files = await PgGithub.getFiles(
      "https://github.com/solana-labs/example"
    );

    expect(mockSetModal).toHaveBeenCalledWith("SelectProgram", {
      programNames: ["alpha", "beta"],
    });
    expect(files.map(([path]) => path)).toEqual([
      "programs/alpha/src/lib.rs",
      "programs/alpha/src/state.rs",
      "tests/shared.ts",
    ]);
    // 1 tree request + 3 files, `beta` is never downloaded
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("treats a nested program folder as its own program", async () => {
    mockFetch((url) => {
      if (url.startsWith("https://api.github.com/")) {
        return treeResponse([
          "programs/marginfi/src/lib.rs",
          "programs/marginfi/fuzz/src/lib.rs",
          "programs/marginfi/fuzz/corpus.py",
        ]);
      }
      return { body: "content" };
    });
    mockSetModal.mockResolvedValueOnce("marginfi");

    const files = await PgGithub.getFiles(
      "https://github.com/mrgnlabs/marginfi-v2"
    );

    expect(mockSetModal).toHaveBeenCalledWith("SelectProgram", {
      programNames: ["marginfi", "marginfi/fuzz"],
    });
    // Everything under the deeper `marginfi/fuzz` belongs to that program
    expect(files.map(([path]) => path)).toEqual([
      "programs/marginfi/src/lib.rs",
    ]);
  });

  it("does not ask when the repository holds a single program", async () => {
    mockFetch((url) => {
      if (url.startsWith("https://api.github.com/")) {
        return treeResponse(["programs/alpha/src/lib.rs"]);
      }
      return { body: "content" };
    });

    await PgGithub.getFiles("https://github.com/solana-labs/example");

    expect(mockSetModal).not.toHaveBeenCalled();
  });

  it("cancels the import when the selection is closed", async () => {
    mockFetch((url) => {
      if (url.startsWith("https://api.github.com/")) {
        return treeResponse([
          "programs/alpha/src/lib.rs",
          "programs/beta/src/lib.rs",
        ]);
      }
      return { body: "content" };
    });
    mockSetModal.mockResolvedValueOnce(null);

    await expect(
      PgGithub.getFiles("https://github.com/solana-labs/example")
    ).rejects.toBeInstanceOf(ImportCancelledError);
  });

  it("reports a file that cannot be downloaded", async () => {
    mockFetch((url) => {
      if (url.startsWith("https://api.github.com/")) {
        return treeResponse(["src/lib.rs"]);
      }
      return { status: 404, body: "404: Not Found" };
    });

    await expect(
      PgGithub.getFiles("https://github.com/solana-labs/example")
    ).rejects.toMatchObject({
      message: expect.stringMatching(/"src\/lib\.rs" was not found on GitHub/),
      reason: "not-found",
      name: "GithubFileError",
    });
  });
});

describe("PgGithub.isValidUrl", () => {
  it("takes the URL a route gets after the router folds its double slash", () => {
    // react-router turns `/https://github.com/…` into `/https:/github.com/…`
    expect(
      PgGithub.isValidUrl(
        "https:/github.com/solana-foundation/program-examples/tree/main/basics"
      )
    ).toBe(true);
  });

  it("takes a URL with both slashes, and one without a scheme", () => {
    expect(PgGithub.isValidUrl("https://github.com/a/b")).toBe(true);
    expect(PgGithub.isValidUrl("github.com/a/b")).toBe(true);
  });

  it("still refuses a URL of another host", () => {
    expect(PgGithub.isValidUrl("https:/gitlab.com/a/b")).toBe(false);
  });
});

describe("PgGithub.routePath", () => {
  it("puts GitHub's path after /github/, with or without the URL's scheme", () => {
    const path =
      "/github/solana-foundation/program-examples/tree/main/basics/create-account/anchor";
    expect(
      PgGithub.routePath(
        "https://github.com/solana-foundation/program-examples/tree/main/basics/create-account/anchor"
      )
    ).toBe(path);
    expect(
      PgGithub.routePath(
        "github.com/solana-foundation/program-examples/tree/main/basics/create-account/anchor/"
      )
    ).toBe(path);
    // The folded form react-router makes of `https://` in a path
    expect(PgGithub.routePath("https:/www.github.com/a/b")).toBe("/github/a/b");
  });

  it("is a URL the GitHub route accepts again", () => {
    const path = PgGithub.routePath("https://github.com/a/b/tree/main/c");
    expect(
      PgGithub.isValidUrl(`github.com/${path.slice("/github/".length)}`)
    ).toBe(true);
    expect(
      PgGithub.parseUrl(`github.com/${path.slice("/github/".length)}`)
    ).toEqual({
      owner: "a",
      repo: "b",
      ref: "main",
      path: "c",
    });
  });
});

describe("PgGithub.parseUrl", () => {
  it("reads the URL the router folded as it reads the full one", () => {
    const url =
      "github.com/solana-foundation/program-examples/tree/main/basics";
    expect(PgGithub.parseUrl(`https:/${url}`)).toEqual(
      PgGithub.parseUrl(`https://${url}`)
    );
    expect(PgGithub.parseUrl(`https:/${url}`)).toEqual({
      owner: "solana-foundation",
      repo: "program-examples",
      ref: "main",
      path: "basics",
    });
  });
});
