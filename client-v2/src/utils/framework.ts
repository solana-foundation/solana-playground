import { LINE_BREAK } from "@/shared/lib/line-break";

import { PgCommon } from "./common";
import { PgExplorer, TupleFiles } from "./explorer";
import { PgWorkspace } from "./explorer/workspace";
import { ConversionError } from "./import-error";
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

  /** Example GitHub project, when the dialog that imports from GitHub lists one */
  githubExample?: {
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
     * @param name the project the files are from, whose program id the
     * export carries; the open one when not given
     * @returns the frameworks' original layout files
     */
    convertFromPlayground: (
      files: TupleFiles,
      name: string | undefined
    ) => SyncOrAsync<TupleFiles>;
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

/**
 * An import holding Rust or Python that no framework recognises (spec
 * `project-without-program`, a repository with no program imports as a
 * TypeScript project)
 */
const NOT_A_PROGRAM =
  "This doesn't look like a Solana program. Playground opens Anchor, native Rust and Seahorse programs.";

/**
 * An import with nothing to open: no program and no TypeScript or JavaScript
 * (spec `project-without-program`). Shared with `PgGithub`, which refuses an empty path before
 * downloading anything.
 *
 * @param source where the files came from, such as `owner/repo`
 */
export const noProgramCode = (source: string | undefined) =>
  source ? `No program code found in ${source}.` : "No program code found.";

/** What Build compiles: a Rust or Python file anywhere under `src/` */
const PROGRAM_FILE_REGEX = /^src\/.+\.(rs|py)$/;

/** Program source in any layout: a no-program import never drops one */
const PROGRAM_SOURCE_REGEX = /\.(rs|py)$/;

/** A Rust program file where Build compiles it: the as-is import keeps only these */
const RUST_PROGRAM_FILE_REGEX = /^src\/.+\.rs$/;

/** TypeScript and JavaScript, the only files a project with no program runs */
const SCRIPT_FILE_REGEX = /\.[jt]sx?$/;

/**
 * JSON a project with no program keeps beside its scripts: an IDL a client
 * imports, a fixture a test reads
 */
const DATA_FILE_REGEX = /\.json$/i;

/**
 * JSON a project with no program leaves out as tool configuration rather
 * than data: package manifests and npm lockfiles, `tsconfig` and `jsconfig`
 * files, and any dotfile or file in a dot folder (`.vscode/`)
 */
const TOOL_CONFIG_REGEX =
  /(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|(ts|js)config[^/]*\.json)$|(^|\/)\./i;

/**
 * Whether a project with no program keeps the file at `path`: every script,
 * and JSON that is not tool configuration
 */
const isNoProgramFile = (path: string) =>
  SCRIPT_FILE_REGEX.test(path) ||
  (DATA_FILE_REGEX.test(path) && !TOOL_CONFIG_REGEX.test(path));

/**
 * Whether an import from files leaves `path` out, by whole path segment (so
 * `src/target_account.rs` is kept): a dot file or folder (`.git/`), a `..`
 * that would climb out of the project, the dependencies (`node_modules/`),
 * and the build output (`target/`), unless it sits under `src/`, where
 * `target` names a Rust module
 */
const isSkippedImportPath = (path: string) =>
  /(^|\/)(\.[^/.][^/]*|\.\.|node_modules)(\/|$)/.test(path) ||
  (/(^|\/)target(\/|$)/.test(path) && !hasTargetUnderSrc(path));

/**
 * Whether `path` matches what `/(^|\/)src\/(.+\/)?target\//` would, scanned
 * with `indexOf`, since the regex backtracks quadratically on a long path
 */
const hasTargetUnderSrc = (path: string) =>
  path.split(LINE_BREAK).some((chunk, i) => {
    let earliest: number | undefined;
    for (
      let at = chunk.indexOf("src/");
      at !== -1;
      at = chunk.indexOf("src/", at + 1)
    ) {
      // `^` is the path's start only, so a later chunk needs the `/`
      const isSegment = at === 0 ? i === 0 : chunk[at - 1] === "/";
      if (!isSegment) continue;
      if (chunk.startsWith("target/", at + 4)) return true;
      earliest ??= at;
    }
    return (
      earliest !== undefined && chunk.indexOf("/target/", earliest + 5) !== -1
    );
  });

/** A file dropped into Import › From files: the drop zone adds its `path` */
export type ImportedFile = Pick<File, "name" | "text" | "arrayBuffer"> & {
  /**
   * Where the file sat in the drop, as the drop zone gives it (`/p/src/lib.rs`
   * for a dropped folder, `./p.zip` for a picked file); `name` without it
   */
  path?: string;
};

/** A test file, named as the gist format's loose placement names one */
const TEST_FILE_REGEX = /\.(test|spec)\.[jt]sx?$/;

/** The folders a project with no program keeps its files in */
const NO_PROGRAM_FOLDER = { CLIENT: "client", TESTS: "tests" } as const;

/** A path in one of `NO_PROGRAM_FOLDER`'s folders */
// eslint-disable-next-line security/detect-non-literal-regexp -- built from NO_PROGRAM_FOLDER's constants
const IN_NO_PROGRAM_FOLDER_REGEX = new RegExp(
  `^(${Object.values(NO_PROGRAM_FOLDER).join("|")})/`
);

/**
 * A leading folder `toNoProgramLayoutWith` drops, since it puts the file back
 * under `client/` or `tests/` itself; `test/` is read as `tests/`
 */
// eslint-disable-next-line security/detect-non-literal-regexp -- built from NO_PROGRAM_FOLDER's constants
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
 * A file's path below the imported folder, with any leading `/` or `./` gone
 *
 * @param root the imported folder
 * @param fullPath the file's path
 * @returns the path below `root`; a path not under `root` returns whole
 */
const relativeToRoot = (root: string, fullPath: string) => {
  const prefix = root.replace(/^\/+|\/+$/g, "");
  const relative = fullPath.replace(/^\.?\/+/, "");
  return prefix && relative.startsWith(prefix + "/")
    ? relative.slice(prefix.length + 1)
    : relative;
};

/** A crate manifest at the root, which only a foreign layout has */
const ROOT_MANIFEST_REGEX = /^(Cargo\.toml|Xargo\.toml)$/;

/**
 * Whether every program source file is Rust under `src/` and no crate manifest
 * sits at the root, as in a Rust project Export writes. Python is left to
 * Seahorse: a `.py` no framework claims is refused.
 */
const isPlaygroundProgramLayout = (paths: string[]) =>
  paths
    .filter((path) => PROGRAM_SOURCE_REGEX.test(path))
    .every((path) => RUST_PROGRAM_FILE_REGEX.test(path)) &&
  !paths.some((path) => ROOT_MANIFEST_REGEX.test(path));

/**
 * Lay out a repository with no program: tests under `tests/`, every other
 * TypeScript or JavaScript file under `client/`, each keeping its path below
 * the folder that placed it. JSON data is placed by its folder alone (under
 * `tests/` from a leading `tests/` or `test/`, else under `client/`), so an
 * import of an IDL or a fixture from within the same folder still resolves;
 * one that crosses from `client/` to `tests/` does not, as for scripts. Tool
 * configuration (`TOOL_CONFIG_REGEX`) and files of any other kind are left
 * out. When two
 * files want one path, the one `placementRank` puts first gets it and the
 * other keeps its whole path, so nothing is overwritten.
 *
 * @param root the imported folder, dropped from the front of every path
 * @param files repository files
 * @returns the files in the playground layout, in the given order
 */
const toNoProgramLayoutWith =
  (root: string) =>
  (files: TupleFiles): TupleFiles => {
    const wanted = files
      .map(([fullPath, content]) => {
        const path = relativeToRoot(root, fullPath);
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
      .filter(({ path }) => isNoProgramFile(path));

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

    return wanted.map((file) => {
      const path = placed.get(file);
      if (path === undefined) throw new Error(`"${file.path}" was not placed.`);
      return [path, file.content];
    });
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
   * no framework recognises, with all program source Rust under `src/` and no
   * crate manifest at the root (the playground's own layout, as Export writes
   * a Rust project), are kept as they are.
   * Other files no framework recognises are laid out as a project with no
   * program when they hold TypeScript or JavaScript and no Rust or Python: a program in a
   * layout no framework knows is refused, never imported without its source.
   * Such a project keeps its JSON data too (`toNoProgramLayoutWith`), but JSON
   * alone is nothing to open.
   *
   * @param files framework files
   * @returns the playground layout converted files
   * @throws see {@link PgFramework.convertToPlaygroundLayoutWith}
   */
  static convertToPlaygroundLayout(files: TupleFiles) {
    return PgFramework.convertToPlaygroundLayoutWith("")(undefined)(files);
  }

  /**
   * {@link PgFramework.convertToPlaygroundLayout} for an import that has a
   * folder and a name.
   *
   * @param root the imported folder, which a project with no program and an
   * unmarked program in the playground's own layout drop from their paths;
   * frameworks find their own layout wherever it sits
   * @returns a function taking `source`, where the files came from (named in
   * the refusal, `undefined` when there is nothing to name), which returns a
   * function taking the framework files
   * @throws a `ConversionError`: `unsupported` (`NOT_A_PROGRAM`) when no
   * framework recognises the files, they hold Rust or Python, and any of it is
   * Python, sits outside `src/`, or a crate manifest (`Cargo.toml`,
   * `Xargo.toml`) sits at the root; `no-source` (`noProgramCode`) when there
   * is no program and no script; `unsupported` ("Could not convert files")
   * when a framework's conversion returns nothing
   */
  static convertToPlaygroundLayoutWith(root: string) {
    return (source: string | undefined) => async (files: TupleFiles) => {
      const framework = await PgFramework.getFromFiles(files);
      if (!framework) {
        // The root comes off first because `hasProgram` reads paths from the
        // project root; the files return with paths below the imported folder.
        // The layout Export writes for a program that looks like no
        // framework's yet imports as it is
        const ownFiles = files.map(([path, content]): [string, string] => [
          relativeToRoot(root, path),
          content,
        ]);
        const ownPaths = ownFiles.map(([path]) => path);
        if (
          isPlaygroundProgramLayout(ownPaths) &&
          PgFramework.hasProgram(ownPaths)
        ) {
          return ownFiles;
        }

        if (files.some(([path]) => PROGRAM_SOURCE_REGEX.test(path))) {
          throw new ConversionError(NOT_A_PROGRAM, "unsupported");
        }
        const noProgramFiles = toNoProgramLayoutWith(root)(files);
        if (!noProgramFiles.some(([path]) => SCRIPT_FILE_REGEX.test(path))) {
          throw new ConversionError(noProgramCode(source), "no-source");
        }
        return noProgramFiles;
      }

      const { convertToPlayground } = await framework.import();
      const convertedFiles = await convertToPlayground(files);
      if (!convertedFiles.length) {
        throw new ConversionError("Could not convert files", "unsupported");
      }

      return convertedFiles;
    };
  }

  /**
   * Read the files dropped into Import › From files. A zip, which is what
   * Export project downloads, is opened and its files read in its place.
   *
   * @param files the dropped or picked files
   * @returns each file's path and text, those `isSkippedImportPath` names
   * left out
   * @throws when a `.zip` cannot be opened, naming it
   */
  static async readImportFiles(files: ImportedFile[]): Promise<TupleFiles> {
    const read: TupleFiles = [];
    for (const file of files) {
      const path = file.path ?? file.name;
      if (isSkippedImportPath(path)) continue;

      if (!/\.zip$/i.test(file.name)) {
        read.push([path, await file.text()]);
        continue;
      }

      // A zip's files sit where the zip did, so a folder holding one keeps a
      // single root
      const folder = path.replace(/^\.?\/+/, "").replace(/[^/]*$/, "");
      const { default: JSZip } = await import("jszip");
      const zip = await JSZip.loadAsync(await file.arrayBuffer()).catch(() => {
        throw new Error(`Could not open ${file.name}: it is not a zip file.`);
      });
      for (const entry of Object.values(zip.files)) {
        const entryPath = entry.name.replace(/^\/+/, "");
        if (entry.dir || isSkippedImportPath(entryPath)) continue;
        read.push([folder + entryPath, await entry.async("string")]);
      }
    }

    return read;
  }

  /**
   * Import › From files: read the dropped files (`readImportFiles`) and lay
   * them out for the playground. A dropped folder's name leads every path,
   * and a project with no program drops it rather than nest the project
   * under it. The folder is read from the drop, not from inside a zip: a
   * project exported with only `tests/` must not lose that folder.
   *
   * @param files the dropped or picked files
   * @returns the playground layout files
   * @throws see {@link PgFramework.readImportFiles} and
   * {@link PgFramework.convertToPlaygroundLayoutWith}
   */
  static async importFiles(files: ImportedFile[]) {
    const read = await PgFramework.readImportFiles(files);
    const folders = new Set(
      files.map(
        // eslint-disable-next-line security/detect-unsafe-regex -- linear: anchored, and `[^/]` stops at the separator
        ({ path, name }) => /^(?:\.?\/)?([^/]+)\//.exec(path ?? name)?.[1]
      )
    );
    const [root] = folders.size === 1 ? [...folders] : [];
    return PgFramework.convertToPlaygroundLayoutWith(root ?? "")(root)(read);
  }

  /**
   * Read a workspace's files, hidden ones left out.
   *
   * @param name the workspace to read
   * @returns the files, paths relative to the workspace root
   * @throws when nothing names a workspace
   */
  static async readWorkspaceFiles(name: string) {
    // An empty name would read the root and zip every workspace as ".zip"
    if (!name) throw new Error(PgWorkspace.errors.CURRENT_NOT_FOUND);
    const workspacePath = PgCommon.appendSlash(
      PgCommon.joinPaths(PgExplorer.PATHS.ROOT_DIR_PATH, name)
    );

    const files: TupleFiles = [];
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

    return files;
  }

  /**
   * Convert playground layout files to their framework's layout.
   *
   * @param files playground layout files
   * @param name the project the files are from
   * @returns the framework's files, the README to show after, and the framework
   * @throws when no framework recognises the files (`isUnknownFramework`)
   */
  static async convertToFramework(files: TupleFiles, name: string) {
    const framework = await this.getFromFiles(files);
    if (!framework) throw new Error(UNKNOWN_FRAMEWORK);

    const { convertFromPlayground, readme } = await framework.export();
    return {
      files: await convertFromPlayground(files, name),
      readme,
      framework: framework.name,
    };
  }

  /**
   * Zip the given files and download the zip as `<name>.zip`.
   *
   * @param name the zip's name, without the extension
   * @param files the files to zip; a path with no file name is a folder
   */
  static async downloadZip(name: string, files: TupleFiles) {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    files.forEach(([path, content]) => {
      const isFile = PgExplorer.getItemTypeFromName(path).file;
      if (isFile) zip.file(path, content);
      else zip.folder(path);
    });
    const blob = await zip.generateAsync({ type: "blob" });
    PgCommon.export(name + ".zip", blob);
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
    if (!name) throw new Error(PgWorkspace.errors.CURRENT_NOT_FOUND);
    let files = await this.readWorkspaceFiles(name);

    // Convert from playground layout to framework layout
    let readme: string | undefined;
    if (opts?.convert)
      ({ files, readme } = await this.convertToFramework(files, name));

    await this.downloadZip(name, files);

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

    /**
     * A repository no framework recognises: scripts and their JSON data are
     * laid out; a program in an unknown layout, or nothing to run, is refused
     */
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
        ).rejects.toMatchObject({
          message: NOT_A_PROGRAM,
          reason: "unsupported",
        });
      });

      it("refuses files a framework claims but converts to nothing", async () => {
        const getFromFiles = vi
          .spyOn(PgFramework, "getFromFiles")
          .mockResolvedValue({
            import: async () => ({ convertToPlayground: async () => [] }),
          } as unknown as Awaited<ReturnType<typeof PgFramework.getFromFiles>>);
        try {
          await expect(
            pathsOf([["programs/a/src/lib.rs", "#[program]"]])
          ).rejects.toMatchObject({
            message: "Could not convert files",
            reason: "unsupported",
          });
        } finally {
          getFromFiles.mockRestore();
        }
      });

      /** What Settings › Export writes is what Import reads back */
      describe("the playground's own layout", () => {
        const imported = async (files: TupleFiles) =>
          PgFramework.convertToPlaygroundLayout(files);

        it("keeps a program no framework marks yet", async () => {
          const files: TupleFiles = [
            ["src/lib.rs", "// Import anchor"],
            ["client/client.ts", "a"],
            ["tests/a.test.ts", "b"],
          ];
          expect(await imported(files)).toEqual(files);
        });

        it("keeps a project with no program", async () => {
          const files: TupleFiles = [["client/client.ts", "a"]];
          expect(await imported(files)).toEqual(files);
        });

        it("hands a finished program to its framework", async () => {
          expect(
            await imported([
              ["programs/p/src/lib.rs", "#[program]\nmod p {}"],
              ["client/client.ts", "a"],
            ])
          ).toEqual([["src/lib.rs", "anchor"]]);
        });

        it("drops the imported folder from an unmarked program", async () => {
          const files = await PgFramework.convertToPlaygroundLayoutWith("p")(
            "p"
          )([
            ["/p/src/lib.rs", "// Import anchor"],
            ["p/client/client.ts", "a"],
          ]);
          expect(files).toEqual([
            ["src/lib.rs", "// Import anchor"],
            ["client/client.ts", "a"],
          ]);
        });

        it("refuses a plain Rust crate", async () => {
          await expect(
            imported([
              ["Cargo.toml", "[package]"],
              ["src/main.rs", "fn main() {}"],
            ])
          ).rejects.toThrow(NOT_A_PROGRAM);
        });

        it("refuses an unmarked program mixed with another outside src", async () => {
          await expect(
            imported([
              ["src/lib.rs", "// Import anchor"],
              ["onchain/src/lib.rs", "fn main() {}"],
            ])
          ).rejects.toThrow(NOT_A_PROGRAM);
        });

        it("keeps a root README beside an unmarked program", async () => {
          const files: TupleFiles = [
            ["src/lib.rs", "// Import anchor"],
            ["client/client.ts", "a"],
            ["README.md", "x"],
          ];
          expect(await imported(files)).toEqual(files);
        });

        it("refuses an unmarked Python program, which only Seahorse may claim", async () => {
          await expect(
            imported([
              ["src/main.py", "x"],
              ["client/client.ts", "a"],
            ])
          ).rejects.toThrow(NOT_A_PROGRAM);
        });

        it("refuses a Python package", async () => {
          await expect(
            imported([
              ["pyproject.toml", "[project]"],
              ["src/pkg/app.py", "print(1)"],
            ])
          ).rejects.toThrow(NOT_A_PROGRAM);
        });

        it("still refuses Rust outside src", async () => {
          await expect(
            imported([
              ["onchain/src/lib.rs", "fn main() {}"],
              ["client/client.ts", "a"],
            ])
          ).rejects.toThrow(NOT_A_PROGRAM);
          await expect(
            imported([
              ["main.rs", "fn main() {}"],
              ["client/client.ts", "a"],
            ])
          ).rejects.toThrow(NOT_A_PROGRAM);
        });
      });

      it("drops the imported folder from every path", async () => {
        const files: TupleFiles = [
          ["token/client/index.ts", "a"],
          ["token/client/tests/a.ts", "b"],
        ];
        const paths = (
          await PgFramework.convertToPlaygroundLayoutWith("token/client")(
            undefined
          )(files)
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
          PgFramework.convertToPlaygroundLayoutWith("")("alice/docs")([
            ["README.md", "x"],
          ])
        ).rejects.toMatchObject({
          message: "No program code found in alice/docs.",
          reason: "no-source",
        });
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

      /** A project with no program keeps the JSON its scripts import */
      describe("JSON files", () => {
        it("keeps an IDL and a fixture beside the scripts that read them", async () => {
          expect(
            await pathsOf([
              ["src/index.ts", 'import idl from "../idl/x.json";'],
              ["idl/x.json", "{}"],
              ["tests/a.test.ts", 'import a from "./fixtures/a.json";'],
              ["tests/fixtures/a.json", "{}"],
            ])
          ).toEqual([
            "client/idl/x.json",
            "client/src/index.ts",
            "tests/a.test.ts",
            "tests/fixtures/a.json",
          ]);
          const [, idl] = (
            await PgFramework.convertToPlaygroundLayout([
              ["a.ts", "a"],
              ["idl/x.json", '{"name":"x"}'],
            ])
          )[1];
          expect(idl).toBe('{"name":"x"}');
        });

        it("places JSON from a test folder under tests", async () => {
          expect(
            await pathsOf([
              ["run.ts", "a"],
              ["test/data/b.json", "{}"],
            ])
          ).toEqual(["client/run.ts", "tests/data/b.json"]);
        });

        it("leaves out package manifests and tool configuration", async () => {
          expect(
            await pathsOf([
              ["index.ts", "a"],
              ["package.json", "{}"],
              ["client/package.json", "{}"],
              ["tsconfig.json", "{}"],
              ["tsconfig.build.json", "{}"],
              ["tests/tsconfig.json", "{}"],
              ["jsconfig.json", "{}"],
              [".eslintrc.json", "{}"],
              [".vscode/settings.json", "{}"],
              ["tests/.fixtures/a.json", "{}"],
              ["package-lock.json", "{}"],
              ["npm-shrinkwrap.json", "{}"],
              ["tsconfig-base.json", "{}"],
              ["TSCONFIG.JSON", "{}"],
            ])
          ).toEqual(["client/index.ts"]);
        });

        it("keeps JSON whatever the case of its extension", async () => {
          expect(
            await pathsOf([
              ["a.ts", "a"],
              ["idl/X.JSON", "{}"],
            ])
          ).toEqual(["client/a.ts", "client/idl/X.JSON"]);
        });

        it("keeps a fixture whose name only ends like a lockfile", async () => {
          expect(
            await pathsOf([
              ["a.ts", "a"],
              ["tests/fixtures/file-lock.json", "{}"],
            ])
          ).toEqual(["client/a.ts", "tests/fixtures/file-lock.json"]);
        });

        it("reads JSON paths from the imported folder", async () => {
          const files = await PgFramework.convertToPlaygroundLayoutWith(
            "token/client"
          )(undefined)([
            ["token/client/index.ts", "a"],
            ["token/client/idl/x.json", "{}"],
            ["token/client/package.json", "{}"],
            ["token/.config/y.json", "{}"],
          ]);
          expect(files.map(([path]) => path).sort()).toEqual([
            "client/idl/x.json",
            "client/index.ts",
          ]);
        });

        it("gives a contested JSON path to the top-level file", async () => {
          expect(
            await PgFramework.convertToPlaygroundLayout([
              ["client/x.json", "nested"],
              ["x.json", "root"],
              ["a.ts", "a"],
            ])
          ).toEqual([
            ["client/client/x.json", "nested"],
            ["client/x.json", "root"],
            ["client/a.ts", "a"],
          ]);
        });

        it("finds nothing to open in JSON alone", async () => {
          await expect(
            pathsOf([
              ["idl/x.json", "{}"],
              ["data.json", "{}"],
            ])
          ).rejects.toThrow("No program code found.");
        });
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

    describe("isSkippedImportPath", () => {
      it.each([
        ["target/deploy/p.so", true],
        ["src/target/mod.rs", false],
        ["programs/p/src/a/target/b.rs", false],
        ["src/a/target/src/b.rs", false],
        // `.+` before the `/` needs a character
        ["src//target/b.rs", true],
        // `^` is the path's start, not a line's
        ["x\nsrc/target/b.rs", true],
        // `src` must start a segment
        ["mysrc/target/x.rs", true],
      ])("%j -> %s", (path, expected) => {
        expect(isSkippedImportPath(path)).toBe(expected);
      });

      it(
        "scans a long path of src/ segments in linear time",
        { timeout: 1000 },
        () => {
          expect(hasTargetUnderSrc("src/".repeat(200_000))).toBe(false);
        }
      );
    });

    describe("PgFramework.readImportFiles", () => {
      const file = (path: string, content: string) =>
        Object.assign(new File([content], path.split("/").at(-1) ?? path), {
          path,
        });

      it("reads dropped files by their path", async () => {
        expect(
          await PgFramework.readImportFiles([file("/p/src/lib.rs", "lib")])
        ).toEqual([["/p/src/lib.rs", "lib"]]);
      });

      it("leaves out dot folders, dependencies and build output", async () => {
        const read = await PgFramework.readImportFiles([
          file("/p/.git/config", "x"),
          file("/p/node_modules/a/index.js", "x"),
          file("/p/target/deploy/p-keypair.json", "x"),
          file("/p/src/target_account.rs", "x"),
          // A Rust module may be named `target`
          file("/p/src/target/mod.rs", "x"),
        ]);
        expect(read.map(([path]) => path)).toEqual([
          "/p/src/target_account.rs",
          "/p/src/target/mod.rs",
        ]);
      });

      const zipOf = async (entries: string[]) => {
        const zip = new JSZip();
        entries.forEach((entry) => zip.file(entry, entry));
        return zip.generateAsync({ type: "blob" });
      };
      const zipFile = (path: string, blob: Blob) =>
        Object.assign(new File([blob], path.split("/").at(-1) ?? path), {
          path,
        });

      it("keeps a zip's files in the folder it was dropped from", async () => {
        const blob = await zipOf(["src/lib.rs"]);
        expect(
          await PgFramework.readImportFiles([zipFile("/p/p.zip", blob)])
        ).toEqual([["p/src/lib.rs", "src/lib.rs"]]);
      });

      it("keeps a zip's files inside the project", async () => {
        const blob = await zipOf(["../escape.rs", "/src/lib.rs"]);
        const read = await PgFramework.readImportFiles([
          zipFile("./p.zip", blob),
        ]);
        // JSZip resolves `..` itself; a leading `/` is dropped here
        expect(read.map(([path]) => path)).toEqual(["escape.rs", "src/lib.rs"]);
      });

      it("names the file it cannot open as a zip", async () => {
        await expect(
          PgFramework.readImportFiles([file("./notes.zip", "not a zip")])
        ).rejects.toThrow("Could not open notes.zip: it is not a zip file.");
      });

      it("opens a zip and reads what is inside", async () => {
        const zip = new JSZip();
        zip.file("src/lib.rs", "lib");
        zip.file("target/deploy/p-keypair.json", "[]");
        zip.folder("app");
        const blob = await zip.generateAsync({ type: "blob" });
        expect(
          await PgFramework.readImportFiles([
            Object.assign(new File([blob], "p.zip"), { path: "./p.zip" }),
          ])
        ).toEqual([["src/lib.rs", "lib"]]);
      });
    });
  });
}
