import { filterRepoFiles, ImportCancelledError, PgGithub } from "./github";
import type { ImportProgress } from "./github";

// `./explorer` boots lightning-fs on import, which needs a real IndexedDB.
vi.mock("./explorer", () => ({ PgExplorer: {} }));

vi.mock("./framework", () => ({
  PgFramework: { convertToPlaygroundLayout: (files: unknown) => files },
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
    ).rejects.toThrow(/hourly request limit/);
  });

  it("explains that the repository was not found", async () => {
    mockFetch(() => ({ status: 404, body: { message: "Not Found" } }));

    await expect(
      PgGithub.getFiles("https://github.com/solana-labs/example")
    ).rejects.toThrow(/was not found on GitHub/);
  });

  it("refuses to import a partially listed repository", async () => {
    mockFetch(() => treeResponse(["src/lib.rs"], true));

    await expect(
      PgGithub.getFiles("https://github.com/solana-labs/example")
    ).rejects.toThrow(/too large to import/);
  });

  it("reports a path that holds no source files", async () => {
    mockFetch(() => treeResponse(["docs/logo.png"]));

    await expect(
      PgGithub.getFiles(
        "https://github.com/solana-labs/example/tree/master/docs"
      )
    ).rejects.toThrow(/No source files found in "docs"/);
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
    ).rejects.toThrow(/"src\/lib\.rs" was not found on GitHub/);
  });
});
