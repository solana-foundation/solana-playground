import { PgCommon } from "./common";
import { PgExplorer, TupleFiles } from "./explorer";
import { PgWorkspace } from "./explorer/workspace";
import type { RequiredKey, SyncOrAsync } from "./types";

/** Framework creation parameter */
export type FrameworkParam<N extends string> = {
  /** Framework name */
  name: N;

  /** Framework description */
  description: string;

  /** Framework program language */
  language: LanguageName;

  /** Image icon src, defaults to `/frameworks/icon.png` */
  icon?: string;

  /** Whether to make the image circular */
  circleImage?: boolean;

  /** Framework documentation */
  docs?: {
    /** Framework documentation URL */
    url: string;
    /** Framework documentation name, defaults to the framework `name` */
    name?: string;
    /** Framework documentation description, defaults to the framework `description` */
    description?: string;
  };

  /** Example GitHub project */
  githubExample: {
    /** Project name */
    name: string;
    /** Project GitHub URL */
    url: string;
  };

  /** Default file to open after loading the default framework files */
  defaultOpenFile?: string;

  /**
   * Get whether the given files have this framework's layout.
   *
   * @param files files with either playground's layout or framework's layout
   * @returns whether the given files belong to this framework
   */
  getIsCurrent: (files: TupleFiles) => SyncOrAsync<boolean>;

  /** Lazy load default framework files, defaults to `./files` */
  getDefaultFiles?: () => Promise<{
    /** Default framework files to create on a new project */
    files: TupleFiles;
  }>;

  /** Lazy load the **to** playground conversion module, defaults to `./import` */
  import?: () => Promise<{
    /**
     * Convert the given framework layout files to playground layout files.
     *
     * @param files framework layout files
     * @returns the playground layout files
     */
    convertToPlayground: (files: TupleFiles) => SyncOrAsync<TupleFiles>;
  }>;

  /** Lazy load the **from** playground conversion module, defaults to `./export` */
  export?: () => Promise<{
    /**
     * Convert the given playground layout files to the framework's original
     * layout files.
     *
     * @param files playground layout files
     * @returns the frameworks' original layout files
     */
    convertFromPlayground: (files: TupleFiles) => SyncOrAsync<TupleFiles>;
    /** Markdown text to show after conversion */
    readme: string;
  }>;
};

/** Created framework */
export type Framework<N extends string = string> = RequiredKey<
  FrameworkParam<N>,
  "icon" | "getIsCurrent" | "getDefaultFiles" | "import" | "export"
>;

/** What `exportWorkspace` throws when it cannot tell a project's framework */
const UNKNOWN_FRAMEWORK = "Could not identify framework";

/** An import holding Rust or Python that no framework recognises (spec 10) */
const NOT_A_PROGRAM =
  "This doesn't look like a Solana program. Playground opens Anchor, native Rust and Seahorse programs.";

/**
 * An import with nothing to open: no program and no TypeScript or JavaScript
 * (spec 10). Shared with `PgGithub`, which refuses an empty path before
 * downloading anything.
 *
 * @param source where the files came from, such as `owner/repo`
 */
export const noProgramCode = (source?: string) =>
  source ? `No program code found in ${source}.` : "No program code found.";

/** What Build compiles: a Rust or Python file anywhere under `src/` */
const PROGRAM_FILE_REGEX = /^src\/.+\.(rs|py)$/;

/** Program source in any layout: a no-program import never drops one */
const PROGRAM_SOURCE_REGEX = /\.(rs|py)$/;

/** TypeScript and JavaScript, the only files a project with no program runs */
const SCRIPT_FILE_REGEX = /\.[jt]sx?$/;

/** A test file, named as the gist format's loose placement names one */
const TEST_FILE_REGEX = /\.(test|spec)\.[jt]sx?$/;

/** The folders a project with no program keeps its files in */
const NO_PROGRAM_FOLDER = { CLIENT: "client", TESTS: "tests" } as const;

/** A path in one of `NO_PROGRAM_FOLDER`'s folders */
const IN_NO_PROGRAM_FOLDER_REGEX = new RegExp(
  `^(${Object.values(NO_PROGRAM_FOLDER).join("|")})/`
);

/**
 * A leading folder `toNoProgramLayout` drops, since it puts the file back
 * under `client/` or `tests/` itself; `test/` is read as `tests/`
 */
const LEADING_FOLDER_REGEX = new RegExp(
  `^(${Object.values(NO_PROGRAM_FOLDER).join("|")}|test)/`
);

/**
 * Which file gets a contested path first, so the result does not depend on
 * the order the files arrive in: a file at the top level, then one in
 * `client/` or `tests/`, then one in `test/`
 */
const placementRank = (folder: string | undefined) => {
  if (!folder) return 0;
  return folder === "test" ? 2 : 1;
};

/**
 * Give `path` a free name: itself, or itself with `-2`, `-3`, ... before the
 * extension
 *
 * @param path the wanted path
 * @param taken paths already handed out
 * @returns a path not in `taken`
 */
const freePath = (path: string, taken: Set<string>) => {
  if (!taken.has(path)) return path;
  const dot = path.lastIndexOf(".");
  for (let n = 2; ; n++) {
    const candidate = `${path.slice(0, dot)}-${n}${path.slice(dot)}`;
    if (!taken.has(candidate)) return candidate;
  }
};

/**
 * Lay out a repository with no program: tests under `tests/`, every other
 * TypeScript or JavaScript file under `client/`, each keeping its path below
 * the folder that placed it. Files of any other kind are left out. When two
 * files want one path, the one `placementRank` puts first gets it and the
 * other keeps its whole path, so nothing is overwritten.
 *
 * @param files repository files
 * @param root the imported folder, dropped from the front of every path
 * @returns the files in the playground layout, in the given order, empty
 * when none is a script
 */
const toNoProgramLayout = (files: TupleFiles, root: string): TupleFiles => {
  const prefix = root.replace(/^\/+|\/+$/g, "");
  const wanted = files
    .map(([fullPath, content]) => {
      const relative = fullPath.replace(/^\.?\/+/, "");
      const path =
        prefix && relative.startsWith(prefix + "/")
          ? relative.slice(prefix.length + 1)
          : relative;
      const folder = LEADING_FOLDER_REGEX.exec(path)?.[1];
      const rest = folder ? path.slice(folder.length + 1) : path;
      const isTest =
        folder === NO_PROGRAM_FOLDER.TESTS ||
        folder === "test" ||
        TEST_FILE_REGEX.test(rest);
      const target = isTest
        ? NO_PROGRAM_FOLDER.TESTS
        : NO_PROGRAM_FOLDER.CLIENT;
      return { path, content, folder, rest, target };
    })
    .filter(({ path }) => SCRIPT_FILE_REGEX.test(path));

  const taken = new Set<string>();
  const placed = new Map<typeof wanted[number], string>();
  [...wanted]
    .sort((a, b) => placementRank(a.folder) - placementRank(b.folder))
    .forEach((file) => {
      const own = `${file.target}/${file.rest}`;
      const path = taken.has(own)
        ? freePath(`${file.target}/${file.path}`, taken)
        : own;
      taken.add(path);
      placed.set(file, path);
    });

  return wanted.map((file) => [placed.get(file)!, file.content]);
};

export class PgFramework {
  /**
   * Whether an export failed only because the project's framework could not
   * be told: an expected outcome for a project of no known framework, which
   * still exports as is.
   */
  static isUnknownFramework(error: unknown) {
    return error instanceof Error && error.message === UNKNOWN_FRAMEWORK;
  }

  /** All frameworks */
  static all: Framework<FrameworkName>[];

  /**
   * Get the framework from its name.
   *
   * @param name framework name
   * @returns the framework
   */
  static get(name: FrameworkName) {
    return this.all.find((f) => f.name === name)!;
  }

  /**
   * Get the framework from the given files.
   *
   * @param files files to check, defaults to current project files
   * @returns the framework
   */
  static async getFromFiles(files: TupleFiles = PgExplorer.getAllFiles()) {
    for (const framework of this.all) {
      const isCurrent = await framework.getIsCurrent(files);
      if (isCurrent) return framework;
    }
  }

  /**
   * Get whether the given project files hold a program, i.e. whether Build
   * has anything to compile. Framework detection is not used: a program
   * being written may not look like any framework's yet.
   *
   * @param paths file paths relative to the project root
   * @returns whether a Rust or Python file sits under `src/`
   */
  static hasProgram(paths: string[]) {
    return paths.some((path) => PROGRAM_FILE_REGEX.test(path));
  }

  /**
   * Get whether the given project files hold something a project with no
   * program can run: a TypeScript or JavaScript file under `client/` or
   * `tests/`.
   *
   * @param paths file paths relative to the project root
   * @returns whether such a file exists
   */
  static hasRunnableTypeScript(paths: string[]) {
    return paths.some(
      (path) =>
        IN_NO_PROGRAM_FOLDER_REGEX.test(path) && SCRIPT_FILE_REGEX.test(path)
    );
  }

  /**
   * Convert files with the framework layout to the playground layout. Files
   * no framework recognises are laid out as a project with no program when
   * they hold TypeScript or JavaScript and no Rust or Python: a program in a
   * layout no framework knows is refused, never imported without its source.
   * Other files of such a project are left out.
   *
   * @param files framework files
   * @param root the imported folder, which a project with no program drops
   * from its paths; frameworks find their own layout wherever it sits
   * @param opts.source where the files came from, named in the refusal
   * @returns the playground layout converted files
   * @throws `NOT_A_PROGRAM` when no framework recognises program source;
   * `noProgramCode` when there is no program and no script; "Could not
   * convert files" when a framework's conversion returns nothing
   */
  static async convertToPlaygroundLayout(
    files: TupleFiles,
    root = "",
    opts?: { source?: string }
  ) {
    const framework = await this.getFromFiles(files);
    if (!framework) {
      if (files.some(([path]) => PROGRAM_SOURCE_REGEX.test(path))) {
        throw new Error(NOT_A_PROGRAM);
      }
      const noProgramFiles = toNoProgramLayout(files, root);
      if (!noProgramFiles.length) throw new Error(noProgramCode(opts?.source));
      return noProgramFiles;
    }

    const { convertToPlayground } = await framework.import();
    const convertedFiles = await convertToPlayground(files);
    if (!convertedFiles.length) throw new Error("Could not convert files");

    return convertedFiles;
  }

  /**
   * Export a workspace as a zip file: the open one, unless `opts.name` names
   * another.
   *
   * @param opts options
   * - `convert`: whether to convert the playground layout to the framework's layout
   * - `name`: the workspace to export; the open one by default
   * @returns README Markdown text if `opts.convert` is `true`
   * @throws when `opts.convert` is set and the framework cannot be told
   * (`PgFramework.isUnknownFramework`), and when nothing names a workspace
   */
  static async exportWorkspace<C extends boolean = false>(opts?: {
    convert?: C;
    /** The workspace to export; the open one by default */
    name?: string;
  }) {
    const name = opts?.name ?? PgExplorer.currentWorkspaceName;
    // An empty name would read the root and zip every workspace as ".zip"
    if (!name) throw new Error(PgWorkspace.errors.CURRENT_NOT_FOUND);
    const workspacePath = PgCommon.appendSlash(
      PgCommon.joinPaths(PgExplorer.PATHS.ROOT_DIR_PATH, name)
    );

    let files: TupleFiles = [];
    const recursivelyGetItems = async (path: string) => {
      const itemNames = await PgExplorer.fs.readDir(path);
      const subItemPaths = itemNames
        .filter((itemName) => !itemName.startsWith("."))
        .map((itemName) => PgCommon.appendSlash(path) + itemName);

      for (const subItemPath of subItemPaths) {
        const metadata = await PgExplorer.fs.getMetadata(subItemPath);
        if (metadata.isFile()) {
          // Not `getRelativePath`: it resolves against the open workspace
          const relativePath = subItemPath.slice(workspacePath.length);
          const content = await PgExplorer.fs.readToString(subItemPath);
          files.push([relativePath, content]);
        } else {
          await recursivelyGetItems(subItemPath);
        }
      }
    };
    await recursivelyGetItems(workspacePath);

    // Convert from playground layout to framework layout
    let readme: string | undefined;
    if (opts?.convert) {
      const framework = await this.getFromFiles(files);
      if (!framework) throw new Error(UNKNOWN_FRAMEWORK);

      const frameworkFrom = await framework.export();
      readme = frameworkFrom.readme;
      files = await frameworkFrom.convertFromPlayground(files);
    }

    // Compress Zip
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    files.forEach(([path, content]) => {
      const isFile = PgExplorer.getItemTypeFromName(path).file;
      if (isFile) zip.file(path, content);
      else zip.folder(path);
    });
    const blob = await zip.generateAsync({ type: "blob" });
    PgCommon.export(name + ".zip", blob);

    return { readme } as { readme: C extends true ? string : undefined };
  }
}

if (import.meta.vitest) {
  const {
    describe,
    it,
    expect,
    vi,
    beforeEach,
    afterEach,
    beforeAll,
    afterAll,
  } = import.meta.vitest;

  describe("utils/framework", () => {
    let JSZip: typeof import("jszip");
    beforeAll(async () => {
      ({ default: JSZip } = await import("jszip"));
    });
    /**
     * `exportWorkspace` exported only the open workspace: the navigation's
     * project list exports any project from its menu, so it takes a name.
     */

    const reset = async () => {
      (
        PgExplorer.fs as unknown as { __files: Map<string, string> }
      ).__files.clear();
      const statics = PgExplorer as unknown as {
        _workspace: unknown;
        _initializedWorkspaceName: unknown;
      };
      statics._workspace = null;
      statics._initializedWorkspaceName = null;
      await PgExplorer.init();
    };

    const zipped = async (blob: Blob) => {
      const zip = await JSZip.loadAsync(await blob.arrayBuffer());
      return Object.keys(zip.files).filter((path) => !zip.files[path].dir);
    };

    describe("PgFramework.exportWorkspace", () => {
      beforeEach(reset);
      afterEach(() => vi.restoreAllMocks());

      it("exports the named workspace while another one is open", async () => {
        await PgExplorer.createWorkspace("alpha", {
          files: [["/alpha/src/lib.rs", "alpha();"]],
        });
        await PgExplorer.createWorkspace("beta", {
          files: [["/beta/src/lib.rs", "beta();"]],
        });
        expect(PgExplorer.currentWorkspaceName).toBe("beta");
        const exported = vi
          .spyOn(PgCommon, "export")
          .mockImplementation(() => {});

        await PgFramework.exportWorkspace({ name: "alpha" });

        const [fileName, blob] = exported.mock.calls[0] as [string, Blob];
        expect(fileName).toBe("alpha.zip");
        expect(await zipped(blob)).toEqual(["src/lib.rs"]);
      });

      it("refuses an empty name rather than export the open workspace", async () => {
        await PgExplorer.createWorkspace("beta", {
          files: [["/beta/src/lib.rs", "beta();"]],
        });
        const exported = vi
          .spyOn(PgCommon, "export")
          .mockImplementation(() => {});

        await expect(
          PgFramework.exportWorkspace({ name: "" })
        ).rejects.toThrow();
        expect(exported).not.toHaveBeenCalled();
      });

      it("exports the open workspace when no name is given", async () => {
        await PgExplorer.createWorkspace("beta", {
          files: [["/beta/src/lib.rs", "beta();"]],
        });
        const exported = vi
          .spyOn(PgCommon, "export")
          .mockImplementation(() => {});

        await PgFramework.exportWorkspace();

        const [fileName, blob] = exported.mock.calls[0] as [string, Blob];
        expect(fileName).toBe("beta.zip");
        expect(await zipped(blob)).toEqual(["src/lib.rs"]);
      });
    });

    /** A repository no framework recognises: scripts are laid out, anything else refused */
    describe("PgFramework.convertToPlaygroundLayout", () => {
      // The real frameworks import the settings, which need the app's
      // globals; one that claims `programs/` stands in for Anchor.
      let all: typeof PgFramework.all;
      beforeAll(() => {
        all = PgFramework.all;
        PgFramework.all = [
          {
            name: "Anchor",
            getIsCurrent: (files: TupleFiles) =>
              files.some(([path]) => path.startsWith("programs/")),
            import: async () => ({
              convertToPlayground: () => [["src/lib.rs", "anchor"]],
            }),
          } as unknown as Framework<FrameworkName>,
        ];
      });
      afterAll(() => {
        PgFramework.all = all;
      });

      const pathsOf = async (files: TupleFiles) =>
        (await PgFramework.convertToPlaygroundLayout(files))
          .map(([path]) => path)
          .sort();

      it("lays out a client and its tests", async () => {
        expect(
          await pathsOf([
            ["index.ts", "a"],
            ["lib/rpc.ts", "b"],
            ["tests/rpc.test.ts", "c"],
          ])
        ).toEqual([
          "client/index.ts",
          "client/lib/rpc.ts",
          "tests/rpc.test.ts",
        ]);
      });

      it("keeps folders and drops other kinds", async () => {
        expect(
          await pathsOf([
            ["src/app/main.ts", "a"],
            ["test/unit/math.ts", "b"],
            ["client/run.ts", "c"],
            ["README.md", "d"],
            ["package.json", "{}"],
          ])
        ).toEqual([
          "client/run.ts",
          "client/src/app/main.ts",
          "tests/unit/math.ts",
        ]);
      });

      it("puts a spec file outside tests under tests", async () => {
        expect(await pathsOf([["lib/math.spec.ts", "a"]])).toEqual([
          "tests/lib/math.spec.ts",
        ]);
      });

      it("refuses a program no framework recognises rather than drop it", async () => {
        await expect(
          pathsOf([
            ["onchain/src/lib.rs", "fn main() {}"],
            ["client.ts", "a"],
          ])
        ).rejects.toThrow(NOT_A_PROGRAM);
        await expect(
          pathsOf([
            ["prog/main.py", "x"],
            ["client.ts", "a"],
          ])
        ).rejects.toThrow(NOT_A_PROGRAM);
      });

      it("drops the imported folder from every path", async () => {
        const files: TupleFiles = [
          ["token/client/index.ts", "a"],
          ["token/client/tests/a.ts", "b"],
        ];
        const paths = (
          await PgFramework.convertToPlaygroundLayout(files, "token/client")
        )
          .map(([path]) => path)
          .sort();
        expect(paths).toEqual(["client/index.ts", "tests/a.ts"]);
      });

      it("keeps both files whichever comes first", async () => {
        const files = await PgFramework.convertToPlaygroundLayout([
          ["client/a.ts", "nested"],
          ["a.ts", "root"],
          ["test/b.ts", "test"],
          ["tests/b.ts", "tests"],
          ["tests/tests/b.ts", "deep"],
        ]);
        expect(files).toEqual([
          ["client/client/a.ts", "nested"],
          ["client/a.ts", "root"],
          ["tests/test/b.ts", "test"],
          ["tests/b.ts", "tests"],
          ["tests/tests/b.ts", "deep"],
        ]);
      });

      it("never hands out one path twice", async () => {
        const files = await PgFramework.convertToPlaygroundLayout([
          ["client/client/a.ts", "1"],
          ["client/a.ts", "2"],
          ["a.ts", "3"],
        ]);
        expect(new Set(files.map(([path]) => path)).size).toBe(3);
      });

      it("keeps both files when two land on one path", async () => {
        const files = await PgFramework.convertToPlaygroundLayout([
          ["a.ts", "root"],
          ["client/a.ts", "nested"],
        ]);
        expect(files).toEqual([
          ["client/a.ts", "root"],
          ["client/client/a.ts", "nested"],
        ]);
      });

      it("refuses a repository with neither, naming where it looked", async () => {
        await expect(pathsOf([["README.md", "x"]])).rejects.toThrow(
          "No program code found."
        );
        await expect(
          PgFramework.convertToPlaygroundLayout([["README.md", "x"]], "", {
            source: "alice/docs",
          })
        ).rejects.toThrow("No program code found in alice/docs.");
      });

      it("leaves an Anchor repository to Anchor", async () => {
        const paths = await pathsOf([
          [
            "programs/p/src/lib.rs",
            "use anchor_lang::prelude::*;\n#[program]\nmod p {}",
          ],
          ["app/x.ts", "a"],
        ]);
        expect(paths).toContain("src/lib.rs");
        expect(paths).not.toContain("client/programs/p/src/lib.rs");
      });
    });

    describe("PgFramework.hasProgram", () => {
      it.each([
        ["src/lib.rs", true],
        ["src/instructions/mod.rs", true],
        ["src/x.py", true],
        ["client/x.ts", false],
        ["client/src/lib.rs", false],
        ["src/notes.md", false],
        ["src/", false],
      ])("%s -> %s", (path, expected) => {
        expect(PgFramework.hasProgram([path])).toBe(expected);
      });
    });

    describe("PgFramework.hasRunnableTypeScript", () => {
      it.each([
        ["client/a.ts", true],
        ["tests/a.test.js", true],
        ["client/nested/a.tsx", true],
        ["a.ts", false],
        ["client/notes.md", false],
        ["src/lib.rs", false],
      ])("%s -> %s", (path, expected) => {
        expect(PgFramework.hasRunnableTypeScript([path])).toBe(expected);
      });
    });
  });
}
