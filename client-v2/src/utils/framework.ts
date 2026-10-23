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
   * Convert files with the framework layout to the playground layout.
   *
   * @param files framework files
   * @returns the playground layout converted files
   */
  static async convertToPlaygroundLayout(files: TupleFiles) {
    const framework = await this.getFromFiles(files);
    if (!framework) throw new Error(UNKNOWN_FRAMEWORK);

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
  const { describe, it, expect, vi, beforeEach, afterEach, beforeAll } =
    import.meta.vitest;

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
  });
}
