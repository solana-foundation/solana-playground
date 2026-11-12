import {
  checkProjectLimits,
  checkWriteTo,
  isSyncedPath,
  limitKind,
  limitRule,
  limitSummary,
  type ProjectLimitExceeded,
} from "../../entities/project";
import {
  isMissing,
  report,
} from "../../features/persistence/model/diagnostics";
import { createLogger } from "../../shared/lib/logger";
import { PgCommon } from "../common";
import { PgLanguage } from "../language";
import type { Disposable } from "../types";
import { PgView } from "../view";
import { PgFs } from "./fs";
import { explorerTelemetry, type LimitActionParam } from "./telemetry";
import type {
  CreatedWorkspace,
  EditorBuffers,
  Explorer,
  ExplorerFiles,
  Folder,
  FullFile,
  ItemMetaFile,
  Position,
  TupleFiles,
} from "./types";
import { PgWorkspace } from "./workspace";
import { forgetFlushed, writeWorkspaceFile } from "./workspace-file";

const log = createLogger("explorer:explorer");

/** What `createItem` takes beside the path and the content */
type CreateItemOptions = {
  skipNameValidation?: boolean;
  override?: boolean;
  openOptions?: OpenOptions;
};

/** Whether a written file opens in the editor, or only refreshes there */
type OpenOptions = {
  dontOpen?: boolean;
  onlyRefreshIfAlreadyOpen?: boolean;
};

/**
 * A create, rename or import the explorer refused because the project would
 * be over a limit. Its own class so a dialog can show it beside its input
 * rather than as a failure the team hears about. It carries the limit too,
 * so a caller can say more than the message without parsing it.
 */
export class ExplorerLimitError extends Error {
  constructor(readonly limit: ProjectLimitExceeded, message: string) {
    super(message);
    this.name = "ExplorerLimitError";
  }
}

export class PgExplorer {
  /** Internal state */
  private static _explorer = this._getDefaultState();
  /** Whether the explorer is initialized */
  private static _isInitialized = false;
  /** Whether the current explorer state is temporary */
  private static _isTemporary: boolean;
  /** Workspace functionality */
  private static _workspace: PgWorkspace | null = null;
  /**
   * The stored workspaces, read for a temporary view, which keeps
   * `_workspace` empty: sync and the tab reload take a defined
   * `allWorkspaceNames` or `currentWorkspaceName` to mean a stored workspace
   * is open. What lists or looks up the user's projects whether or not one is
   * open reads it through `storedWorkspaceNames`: the project list, its sync
   * markers, lesson progress and `PgTutorial.isStarted`.
   */
  private static _storedList: PgWorkspace | undefined;
  /** Current initialized workspace name */
  private static _initializedWorkspaceName: string | null = null;
  /** The mounted editor's buffers -- see `registerEditorBuffers` */
  private static _editorBuffers: EditorBuffers | null = null;

  /** `indexedDB` file system */
  static readonly fs = PgFs;

  /** Explorer errors */
  static readonly errors = {
    ALREADY_EXISTS: "Already exists",
    INVALID_NAME: "Invalid name",
    TYPE_MISMATCH: "Types don't match",
    SRC_DELETE: "Cannot delete src folder",
    SRC_RENAME: "Cannot rename src folder",
  };

  /** Explorer event names */
  static readonly events = {
    ON_DID_INIT: "explorerondidinit",
    ON_DID_CREATE_ITEM: "explorerondidcreateitem",
    ON_WILL_RENAME_ITEM: "exploreronwillrenameitem",
    ON_DID_RENAME_ITEM: "explorerondidrenameitem",
    ON_DID_MOVE_ITEM: "explorerondidmoveitem",
    ON_DID_DELETE_ITEM: "explorerondiddeleteitem",
    ON_DID_SAVE_FILE: "explorerondidsavefile",
    ON_DID_RELOAD_FILES: "explorerondidreloadfiles",
    ON_DID_OPEN_FILE: "explorerondidopenfile",
    ON_DID_CLOSE_FILE: "explorerondidclosefile",
    ON_DID_SET_TABS: "explorerondidsettabs",
    ON_DID_CREATE_WORKSPACE: "explorerondidcreateworkspace",
    ON_DID_RENAME_WORKSPACE: "explorerondidrenameworkspace",
    ON_DID_DELETE_WORKSPACE: "explorerondiddeleteworkspace",
    ON_DID_SWITCH_WORKSPACE: "explorerondidswitchworkspace",
    ON_DID_CHANGE_WORKSPACE_LIST: "explorerondidchangeworkspacelist",
  };

  /* -------------------------------- Getters ------------------------------- */

  /** Get whether the explorer is initialized */
  static get isInitialized() {
    return this._isInitialized;
  }

  /** Get whether the current workspace is temporary */
  static get isTemporary() {
    return this._isTemporary;
  }

  /** Get explorer files */
  static get files() {
    return this._explorer.files;
  }

  /** Get explorer tabs */
  static get tabs() {
    return this._explorer.tabs as readonly string[];
  }

  /** Get current file path */
  // TODO: Make this a regular method (implicit getter may cause bugs)
  static get currentFilePath() {
    // Do not use `Array.at` because it gives incorrect results when there is no
    // current file (`this._currentIndex === -1`)
    if (this._currentIndex === -1) return null;
    return this.tabs[this._currentIndex];
  }

  /** Get current file path index */
  private static get _currentIndex() {
    return this._explorer.currentIndex;
  }

  /** Get current workspace name */
  static get currentWorkspaceName() {
    return this._workspace?.currentName;
  }

  /**
   * Stable id of the current workspace.
   *
   * What sync keys on. Unlike the name, it survives a rename -- which is why
   * a renamed project keeps its conversation.
   */
  static get currentWorkspaceId() {
    return this._workspace?.currentId;
  }

  /** Stable id of a workspace by name, or `undefined` if there is none */
  static workspaceIdOf(name: string) {
    return this._workspace?.idOf(name);
  }

  /** Local name of a workspace by id, or `undefined` if there is none */
  static workspaceNameOf(id: string) {
    return this._workspace?.nameOf(id);
  }

  /**
   * Get names of all workspaces, `undefined` in a temporary view. What the
   * user sees as their projects reads `storedWorkspaceNames`.
   */
  static get allWorkspaceNames() {
    return this._workspace?.allNames;
  }

  /**
   * Names of the stored workspaces, which a temporary view (a repository,
   * gist or docs link) lists too, unlike `allWorkspaceNames`: the user's
   * projects stay in the navigation while a link's project is open, and none
   * of them becomes the current one.
   */
  static get storedWorkspaceNames() {
    return this._listOfStored?.allNames;
  }

  /** Stable id of a stored workspace by name, a temporary view's included */
  static storedWorkspaceIdOf(name: string) {
    return this._listOfStored?.idOf(name);
  }

  /** The workspaces in memory, or the stored ones a temporary view read */
  private static get _listOfStored() {
    return this._workspace ?? this._storedList;
  }

  /**
   * Read the names of all workspaces, from the store when a
   * temporary view left none in memory.
   *
   * @returns the stored workspaces' names
   */
  static async readAllWorkspaceNames() {
    if (this._workspace) return this._workspace.allNames;
    // Read beside the view: the list in memory would make the project open
    // before the link the current one again, behind the link's files
    if (this.isTemporary) return (await this._readStoredList()).allNames;
    return (await this._initWorkspaces()).allNames;
  }

  /* ---------------------------- Public methods ---------------------------- */

  /**
   * Re-read the list of workspaces from the store, keeping this tab's own
   * current one. Writes nothing.
   *
   * Tabs of one browser share the store, but each read the list once at load
   * and saved that copy back on every switch -- undoing a workspace another
   * tab had created, deleted or renamed since. Which one is current is every
   * tab's own, and the store holds whichever tab saved last, so that part is
   * never taken from it. A config that cannot be read tells nothing, so the
   * list in memory stays as it is rather than becoming empty.
   *
   * A temporary view has no current workspace to keep, and re-reads the
   * stored list it shows beside the link's project, whose files it leaves
   * alone.
   *
   * @returns `false` when the store's list was left alone and may hold what
   * this tab has yet to see: a change of this tab's own to the list is not
   * saved yet, or the config failed to read. `true` otherwise, a store with
   * no config at all included -- there is nothing in it to take.
   */
  static async refreshWorkspaces() {
    const workspace = this._workspace;
    if (!workspace) {
      return this.isTemporary ? await this._refreshStoredList() : true;
    }
    const saved = this._savedWorkspaces;
    let stored;
    try {
      stored = PgWorkspace.migrate(
        await this.fs.readToJSON(PgWorkspace.WORKSPACES_CONFIG_PATH)
      );
    } catch (e) {
      if (isMissing(e)) return true;
      report("refresh workspaces", e);
      return false;
    }
    // A create, rename or delete of this tab's own changes memory first and
    // saves later, after awaits. Taking the store's list inside that window
    // would undo it -- and so would taking it after a save that landed while
    // it was being read. Its own save follows, and other tabs hear of that.
    const inMemory = JSON.stringify(workspace.get().workspaces);
    if (inMemory !== saved || this._savedWorkspaces !== saved) return false;

    // Read after the wait: the user may have switched while it ran
    workspace.setCurrent({
      workspaces: stored.workspaces,
      currentId: workspace.currentId,
    });
    this._savedWorkspaces = JSON.stringify(stored.workspaces);
    if (this._savedWorkspaces !== saved) {
      PgCommon.createAndDispatchCustomEvent(
        this.events.ON_DID_CHANGE_WORKSPACE_LIST
      );
    }
    return true;
  }

  /**
   * `refreshWorkspaces` for a temporary view: the stored list read again, so
   * the project list follows another tab's create, rename or delete.
   *
   * Taken only if nothing replaced the list during the read. A change made
   * beside the link reads the list and sets the one it saves, and a link or
   * project opened meanwhile sets its own; each is at least as new as this
   * read, which taken after them would put back a name already gone.
   */
  private static async _refreshStoredList() {
    const shown = this._storedList;
    let stored;
    try {
      stored = await this._fetchStoredList();
    } catch (e) {
      report("refresh workspaces", e);
      return false;
    }
    if (this._workspace || !this.isTemporary || this._storedList !== shown) {
      return true;
    }
    this._takeStoredList(stored);
    return true;
  }

  /** The list as this tab last saved or read it, for `refreshWorkspaces` */
  private static _savedWorkspaces: string | null = null;

  /**
   * Initialize explorer.
   *
   * @param params -
   * - `files`: Files to initialize the explorer from
   * - `name`: Initialize the given workspace name
   */
  static init(params?: { files?: ExplorerFiles | TupleFiles; name?: string }) {
    // Two inits running side by side both create the workspace directories
    // and the second fails with EEXIST. React's strict mode mounts the router
    // effect twice, which starts two route handlers at once, so run them one
    // after another instead.
    const run = this._initQueue.then(() => this._init(params));
    this._initQueue = run.catch(() => {});
    return run;
  }

  /** Tail of the running and queued `init` calls */
  private static _initQueue: Promise<void> = Promise.resolve();

  private static async _init(params?: {
    files?: ExplorerFiles | TupleFiles;
    name?: string;
  }) {
    if (params?.files) {
      this._isTemporary = true;
      this._workspace = null;

      // Reset the explorer state
      this._explorer = this._getDefaultState();

      // Files
      this._explorer.files = Array.isArray(params.files)
        ? this._convertToExplorerFiles(params.files)
        : params.files;

      // Tabs, current
      const currentFilePath = this._getDefaultOpenFile(this._explorer.files);
      if (currentFilePath) this.openFile(currentFilePath);

      // The project list goes on showing the user's projects. A list that
      // cannot be read leaves the link's files open, with no projects listed:
      // never the previous link's list, which a rename or delete would write
      // back over the store
      this._storedList = undefined;
      try {
        await this._readStoredList();
      } catch (e) {
        report("read the stored workspaces", e);
      }
    } else if (
      this._initializedWorkspaceName !==
      (params?.name ?? this.currentWorkspaceName)
    ) {
      this._isTemporary = false;
      if (!this._workspace) await this._initWorkspaces();

      // Check whether the workspace exists
      const workspaceName = params?.name ?? this.currentWorkspaceName;
      if (workspaceName && this.allWorkspaceNames!.includes(workspaceName)) {
        await this.switchWorkspace(workspaceName);
      }
      // Reset files if there are no workspaces
      else if (this.allWorkspaceNames!.length === 0) {
        // Reset the explorer state
        this._explorer = this._getDefaultState();
      }
    } else {
      // Skip initializing if the workspace has already been initialized
      return;
    }

    // Sanity check for the tab and current file state
    // Invalid case: https://github.com/solana-playground/solana-playground/issues/91#issuecomment-1336388179
    //
    // This should no longer be an issue after the partial rewrite of explorer,
    // but keeping it anyway just in case the same problem occurs in the future.
    if (PgExplorer.tabs.length && !PgExplorer.currentFilePath) {
      log.warn("Tab and current file state is partially invalid");
      PgExplorer.openFile(PgExplorer.tabs[0]);
    }

    this._isInitialized = true;

    PgCommon.createAndDispatchCustomEvent(this.events.ON_DID_INIT);
  }

  /**
   * If the project is not temporary(default):
   * - Name and path checks
   * - Create new item in `indexedDB`, and save the folder tree at once for a
   *   new file or folder (`_saveTree`), so a reload right after keeps it
   * - If create is successful, also create the item in the state
   *
   * If the project is temporary:
   * - Name and path checks
   * - Create item in the state
   */
  static async createItem(
    path: string,
    content: string = "",
    opts?: CreateItemOptions
  ) {
    const fullPath = this._checkNewItemWith(opts)(path);

    // Before anything is written, on the project as the write leaves it
    // (`checkWriteTo`). A folder holds no bytes and is not counted.
    if (PgExplorer.getItemTypeFromPath(fullPath).file) {
      this._refuseOverLimit(
        "create",
        checkWriteTo(await this._syncedProjectFiles())(
          this.getRelativePath(fullPath)
        )(content)
      );
    }

    await this._writeItemWith(opts)(fullPath, content);
  }

  /**
   * Write a file the playground generates from work already done, such as
   * the Sugar cache, which holds the links of uploads the user has paid for.
   * Unlike `createItem`, the project's limits do not refuse it: refusing
   * would lose that work. A project left over a limit stays local: sync's
   * own check finds it before uploading and the sync banner names the limit. The file is overwritten, and
   * `openOptions` say whether an open editor tab shows the new content.
   */
  static writeGeneratedFileWith(openOptions: OpenOptions) {
    const opts = { override: true, openOptions };
    return async (path: string, content: string) => {
      const fullPath = this._checkNewItemWith(opts)(path);
      if (!PgExplorer.getItemTypeFromPath(fullPath).file) {
        throw new Error(`Not a file path: ${path}`);
      }
      await this._writeItemWith(opts)(fullPath, content);
    };
  }

  /** The full path of an item `createItem` may write, after its name checks */
  private static _checkNewItemWith(opts: CreateItemOptions | undefined) {
    return (path: string) => {
      const fullPath = this.convertToFullPath(path);

      // Invalid name
      if (
        !opts?.skipNameValidation &&
        !PgExplorer.isItemNameValid(PgExplorer.getItemNameFromPath(fullPath))
      ) {
        throw new Error(PgExplorer.errors.INVALID_NAME);
      }

      // Check whether the item already exists
      if (this.files[fullPath] && !opts?.override) {
        throw new Error(PgExplorer.errors.ALREADY_EXISTS);
      }

      return fullPath;
    };
  }

  /** The writes of `createItem` once its checks have passed */
  private static _writeItemWith(opts: CreateItemOptions | undefined) {
    return async (fullPath: string, content: string) => {
      const files = this.files;
      const itemType = PgExplorer.getItemTypeFromPath(fullPath);

      // Ordering of `indexedDB` calls and state calls matter. If `indexedDB` call fails,
      // state will not change. Can't say the same if the ordering was in reverse.
      if (itemType.file) {
        if (!this.isTemporary) {
          await this.fs.writeFile(fullPath, content, { createParents: true });
          // A new file is a change to the folder tree; replacing a file's
          // content is not
          if (!files[fullPath]) await this._saveTree("a create");
        }

        files[fullPath] = {
          content,
          meta: files[fullPath]?.meta ?? {},
        };

        if (!opts?.openOptions || opts?.openOptions?.onlyRefreshIfAlreadyOpen) {
          const isCurrentFile = this.currentFilePath === fullPath;

          // Close the file if we are overriding to correctly display the new content
          if (opts?.override && isCurrentFile) this.closeFile(fullPath);

          // Open if it's the current file or there is no open options
          if (!opts?.openOptions || isCurrentFile) this.openFile(fullPath);
        }
      }
      // Folder
      else {
        if (!this.isTemporary) {
          await this.fs.createDir(fullPath);
          await this._saveTree("a create");
        }

        files[fullPath] = {};
      }

      PgCommon.createAndDispatchCustomEvent(this.events.ON_DID_CREATE_ITEM);

      await this.saveMeta();
    };
  }

  /**
   * If the project is not temporary(default):
   * - Name and path checks
   * - Announce it (`ON_WILL_RENAME_ITEM`), so a pending edit is saved first
   * - Rename in `indexedDB`, and save the folder tree at once (`_saveTree`),
   *   so a reload right after keeps the new name
   * - If rename is successful also rename item in the state
   *
   * If the project is temporary:
   * - Name and path checks
   * - Announce it (`ON_WILL_RENAME_ITEM`)
   * - Rename in state
   */
  static async renameItem(
    oldPath: string,
    newPath: string,
    opts?: { skipNameValidation?: boolean; override?: boolean }
  ) {
    oldPath = this.convertToFullPath(oldPath);
    newPath = this.convertToFullPath(newPath);

    // Return if there is no change
    if (PgCommon.isPathsEqual(newPath, oldPath)) return;

    if (!opts?.skipNameValidation && !PgExplorer.isItemNameValid(newPath)) {
      throw new Error(PgExplorer.errors.INVALID_NAME);
    }
    if (PgCommon.isPathsEqual(oldPath, this.getCurrentSrcPath())) {
      throw new Error(PgExplorer.errors.SRC_RENAME);
    }

    const itemType = PgExplorer.getItemTypeFromPath(oldPath);
    const newItemType = PgExplorer.getItemTypeFromPath(newPath);
    if (
      (itemType.file && !newItemType.file) ||
      (itemType.folder && !newItemType.folder)
    ) {
      throw new Error(PgExplorer.errors.TYPE_MISMATCH);
    }

    if (!opts?.override) {
      // Check whether `newPath` exists because `fs.rename` doesn't throw when
      // `newPath` exists
      let newPathExists: boolean;
      if (itemType.file) {
        newPathExists = !!this.getFile(newPath);
      } else {
        const { files, folders } = this.getFolderContent(newPath);
        newPathExists = files.length > 0 || folders.length > 0;
      }
      if (newPathExists) throw new Error(PgExplorer.errors.ALREADY_EXISTS);
    }

    // A rename moves no bytes and adds no file, so only the path limit
    // applies: a project already over another limit can still be tidied.
    // Checked on every file path the rename produces. Renaming the workspace
    // itself changes no path sync carries, and `getRelativePath` would strip
    // the old name from paths that already hold the new one, so it is not
    // checked; sync's own renames to the account's name come this way too.
    const renamesWorkspace = PgCommon.isPathsEqual(
      oldPath,
      this.getCurrentWorkspacePath() ?? ""
    );
    const moved: Record<string, string> = {};
    if (itemType.file) {
      moved[this.getRelativePath(newPath)] = "";
    } else if (!renamesWorkspace) {
      const newPrefix = oldPath.endsWith("/")
        ? PgCommon.appendSlash(newPath)
        : newPath;
      for (const path in this.files) {
        if (!path.startsWith(oldPath)) continue;
        if (!PgExplorer.getItemTypeFromPath(path).file) continue;
        moved[this.getRelativePath(path.replace(oldPath, newPrefix))] = "";
      }
    }
    const overPath = checkProjectLimits(moved);
    if (overPath?.reason === "path-too-long") {
      this._refuseOverLimit("rename", overPath);
    }

    // Before anything moves, so a pending autosave writes its edit at the old
    // path and the rename carries it over
    PgCommon.createAndDispatchCustomEvent(
      this.events.ON_WILL_RENAME_ITEM,
      oldPath
    );

    // Rename in `indexedDB`. A rename changes only the folder tree, so a
    // reload before it is saved brings the old name back
    if (!this.isTemporary) {
      await this.fs.rename(oldPath, newPath);
      await this._saveTree("a rename");
    }

    // Rename in state
    const files = this.files;
    const rename = (fromPath: string, toPath: string) => {
      // Store the item
      const item = files[fromPath];

      // Delete the old item
      delete files[fromPath];

      // Set the new path
      files[toPath] = item;

      // Handle tabs if it's a file
      if (PgExplorer.getItemTypeFromPath(toPath).file) {
        // Rename tabs manually instead of closing the old file and opening the
        // new file in order to keep the tab order
        const tabIndex = this.tabs.indexOf(fromPath);
        if (tabIndex !== -1) this._explorer.tabs[tabIndex] = toPath;
      }
    };

    // Rename in state
    if (itemType.file) {
      rename(oldPath, newPath);

      // Moving all elements from a folder results with the parent folder
      // disappearing, add the folder back to mitigate
      files[PgExplorer.getParentPathFromPath(oldPath)] = {};
    } else {
      // We need to loop through all files in order to change every child path
      for (const path in files) {
        // /programs/my_program/logs/logfile.log
        // If we are renaming 'my_program' then we can replace '/programs/my_program/'
        // with '/programs/<new_name>/'
        if (path.startsWith(oldPath)) {
          const childPath = path.replace(
            oldPath,
            oldPath.endsWith("/") ? PgCommon.appendSlash(newPath) : newPath
          );
          rename(path, childPath);
        }
      }
    }

    // Set tabs to close the duplicate paths
    if (opts?.override) this.setTabs(this.tabs);

    // Keep the same current file after rename
    PgCommon.createAndDispatchCustomEvent(
      this.events.ON_DID_OPEN_FILE,
      this.getCurrentFile()
    );
    PgCommon.createAndDispatchCustomEvent(
      this.events.ON_DID_RENAME_ITEM,
      oldPath
    );
    PgCommon.createAndDispatchCustomEvent(this.events.ON_DID_MOVE_ITEM, {
      from: oldPath,
      to: newPath,
    });

    await this.saveMeta();
  }

  /**
   * If the project is not temporary(default):
   * - Delete from `indexedDB`(recursively), and save the folder tree at once
   *   (`_saveTree`), so a reload right after does not list it again
   * - If delete is successful, delete from state
   *
   * If the project is temporary:
   * - Delete from state
   */
  static async deleteItem(path: string) {
    const fullPath = this.convertToFullPath(path);

    // Can't delete src folder
    if (PgCommon.isPathsEqual(fullPath, this.getCurrentSrcPath())) {
      throw new Error(PgExplorer.errors.SRC_DELETE);
    }

    if (!this.isTemporary) {
      const metadata = await this.fs.getMetadata(fullPath);
      if (metadata.isFile()) await this.fs.removeFile(fullPath);
      else await this.fs.removeDir(fullPath, { recursive: true });
      // The content goes at once, the tree entry only when the tree is saved:
      // a reload before that lists a file that can no longer be read
      await this._saveTree("a delete");
    }

    // If we are deleting current file's parent(s), we need to set the current
    // file to the last tab
    const isCurrentFile = this.currentFilePath === fullPath;
    const isCurrentParent = this.currentFilePath?.startsWith(fullPath);

    for (const filePath in this.files) {
      if (filePath.startsWith(fullPath)) {
        delete this.files[filePath];
        this.closeFile(filePath);
      }
    }

    // Deleting all elements from a folder results with the parent folder
    // disappearing, add the folder back to mitigate
    this.files[PgExplorer.getParentPathFromPath(fullPath)] = {};

    // Change the current file to the closest tab when current file or its
    // parent is deleted
    if (isCurrentFile || isCurrentParent) {
      const lastTabPath = this.tabs.at(-1);
      if (lastTabPath) this.openFile(lastTabPath);
    }

    PgCommon.createAndDispatchCustomEvent(
      this.events.ON_DID_DELETE_ITEM,
      fullPath
    );

    await this.saveMeta();
  }

  /**
   * Create a new workspace and change the current workspace to the created workspace.
   *
   * @param name new workspace name
   * @param opts -
   * - `files`: `TupleFiles` to create the workspace from
   * - `defaultOpenFile`: default file to open in the editor
   * - `fromTemporary`: whether to create new workspace from a temporary project
   * - `skipNameValidation`: whether to skip workspace name validation
   * - `id`: an existing id to adopt, for a workspace restored from the server
   */
  static async createWorkspace(
    name: string,
    opts?: {
      files?: TupleFiles;
      defaultOpenFile?: string;
      fromTemporary?: boolean;
      skipNameValidation?: boolean;
      id?: string;
    }
  ) {
    name = name.trim();
    if (!opts?.skipNameValidation && !this.isWorkspaceNameValid(name)) {
      throw new Error(PgWorkspace.errors.INVALID_NAME);
    }

    // Before the workspace exists: a refused import leaves nothing behind
    let imported: Record<string, string> | null = null;
    if (opts?.fromTemporary && this.isTemporary) {
      imported = this._projectFiles();
    } else if (opts?.files) {
      imported = Object.fromEntries(
        opts.files.map(([path, content]) => [
          PgExplorer._workspaceRelative(name, path),
          content,
        ])
      );
    }
    if (imported) this._refuseOverLimit("import", checkProjectLimits(imported));

    if (opts?.fromTemporary && this.isTemporary) {
      // The reason we are not just getting the necessary files and re-calling this
      // function with { files } is because we would lose the tab info. Instead we
      // are creating a valid workspace state and writing it to `indexedDB`.

      // Init workspace
      await this._initWorkspaces();
      // Create a new workspace in state
      this._workspace!.create(name);

      // It's important to set `_isTemporary` after the workspace is created,
      // otherwise there is a chance the creation fails, and the state ends up
      // being invalid.
      // See https://github.com/solana-playground/solana-playground/issues/275
      this._isTemporary = false;

      // Change state paths(temporary projects start with /src)
      const getFullPath = (path: string) => {
        return PgCommon.joinPaths(PgExplorer.PATHS.ROOT_DIR_PATH, name, path);
      };
      for (const path in this.files) {
        const data = this.files[path];
        delete this.files[path];
        this.files[getFullPath(path)] = data;
      }
      this.setTabs(this.tabs.map(getFullPath));

      // Save files from state to `indexedDB`
      await this._writeAllFromState();

      await this.switchWorkspace(name);

      return;
    }

    // A temporary view (a repository or gist link) holds no workspace list;
    // a new workspace is added to the stored ones and leaves the view
    if (!this._workspace && this.isTemporary) await this._initWorkspaces();
    if (!this._workspace) throw new Error(PgWorkspace.errors.NOT_FOUND);

    // Create a new workspace in state
    this._workspace.create(name, opts?.id);
    // Only once the create held, as for `fromTemporary` above
    this._isTemporary = false;

    // Create files
    if (opts?.files) {
      for (const [path, content] of opts.files) {
        await this.fs.writeFile(path, content, { createParents: true });
      }

      // Set the default open file
      opts.defaultOpenFile ??= this._getDefaultOpenFile(opts.files);
    }

    await this.switchWorkspace(name, {
      defaultOpenFile: opts?.defaultOpenFile,
    });

    PgCommon.createAndDispatchCustomEvent<CreatedWorkspace>(
      this.events.ON_DID_CREATE_WORKSPACE,
      { id: this.workspaceIdOf(name), imported: false }
    );
  }

  /**
   * Change the current workspace to the given workspace.
   *
   * @param name workspace name to change to
   * @param opts -
   * - `defaultOpenFile`: the file to open in the editor
   */
  static async switchWorkspace(
    name: string,
    opts?: { defaultOpenFile?: string }
  ) {
    // Save metadata before changing the workspace to never lose data
    await this.saveMeta();

    // A temporary view holds no list to switch in: the project list opens a
    // stored project from it
    if (!this._workspace && this.isTemporary) await this._initWorkspaces();

    // A stored workspace is never a temporary view: a repository or gist link
    // that opens an already saved project must not go on skipping its writes
    this._isTemporary = false;

    // Set the workspace
    this.setWorkspaceName(name);
    await this._saveWorkspaces();

    // Initialize the workspace
    await this._initCurrentWorkspace();

    // Open the default file if it has been specified
    if (opts?.defaultOpenFile) {
      this.openFile(opts.defaultOpenFile);

      // Save metadata to never lose default open file
      await this.saveMeta();
    } else {
      PgCommon.createAndDispatchCustomEvent(
        this.events.ON_DID_OPEN_FILE,
        this.getCurrentFile()
      );
    }

    // Set initialized workspace name
    this._initializedWorkspaceName = name;

    // Dispatch change event
    PgCommon.createAndDispatchCustomEvent(this.events.ON_DID_SWITCH_WORKSPACE);
  }

  /**
   * Add a workspace from outside this browser, without opening it.
   *
   * Everything else that creates a workspace switches to it, because the user
   * just asked for it. An imported one arrives while the user is in the middle
   * of something else, and a switch is not private: `routes/tutorials` listens
   * for it and navigates away when the new workspace is not the tutorial,
   * which also closes the open conversation. So this writes the files and
   * registers the workspace, and leaves `currentId` exactly where it was.
   *
   * Only the current workspace is ever held in memory, so the imported files
   * go straight to the backing store -- there is no in-memory state for them
   * to be missing from.
   *
   * @param name workspace name, which must not already be in use
   * @param opts -
   * - `id`: the id to adopt, so the source device and this one agree
   * - `files`: project-relative paths to contents
   */
  static async importWorkspace(
    name: string,
    opts: { id: string; files: Record<string, string> }
  ) {
    if (!this._workspace) throw new Error(PgWorkspace.errors.NOT_FOUND);
    // Before any file is written: the files go under the name, and a name
    // already in use is another workspace's directory
    if (this._workspace.allNames.includes(name)) {
      throw new Error(PgWorkspace.errors.ALREADY_EXISTS);
    }

    for (const [path, content] of Object.entries(opts.files)) {
      await this.fs.writeFile(
        PgCommon.joinPaths(this.PATHS.ROOT_DIR_PATH, name, path),
        content,
        { createParents: true }
      );
    }

    this._workspace.add(name, opts.id);
    await this._saveWorkspaces();

    PgCommon.createAndDispatchCustomEvent<CreatedWorkspace>(
      this.events.ON_DID_CREATE_WORKSPACE,
      { id: opts.id, imported: true }
    );
  }

  /**
   * Overwrite a workspace's files with the given ones.
   *
   * A replace, not a merge: the snapshot is the whole project, so a file
   * deleted on the other device has to disappear here too rather than linger
   * as a file nobody wrote. That is what makes the server's copy authoritative
   * instead of merely newer.
   *
   * Writes to the backing store and leaves the in-memory state alone, because
   * only the current workspace has any -- a caller replacing the *current*
   * workspace has to re-open it afterwards for the editor to catch up.
   *
   * @param name local workspace name, which must already exist
   * @param files project-relative paths to contents
   */
  static async replaceWorkspaceFiles(
    name: string,
    files: Record<string, string>
  ) {
    const dir = PgCommon.joinPaths(this.PATHS.ROOT_DIR_PATH, name);
    const metadataPath = PgCommon.joinPaths(dir, PgWorkspace.METADATA_PATH);

    // Which tabs are open, and where the caret is, is this device's business:
    // the snapshot deliberately leaves it out so that merely *looking* at a
    // project is not a change other devices have to reconcile. That makes it
    // local state, and a sync operation has no business being the thing that
    // deletes it -- which clearing the directory below otherwise does.
    //
    // Losing it is not cosmetic. With no tabs there is no current file, so the
    // editor has nothing to re-read and goes on rendering the version the user
    // just chose to replace, until the page is reloaded.
    const metadata = await this.fs.readToJSONOrDefault<ItemMetaFile>(
      metadataPath,
      []
    );

    try {
      await this.fs.removeDir(dir, { recursive: true });
    } catch {
      // Nothing there to clear is the ordinary case for a workspace that is
      // registered but whose directory never landed; the writes below are
      // what matter
    }
    // Cleared, so a workspace file the snapshot lacks is created again by
    // its next write, which must flush -- even if a write below fails
    forgetFlushed(PgCommon.appendSlash(dir));

    for (const [path, content] of Object.entries(files)) {
      await this.fs.writeFile(PgCommon.joinPaths(dir, path), content, {
        createParents: true,
      });
    }

    // Only the entries that still name a file the incoming snapshot has, so
    // the editor does not come back pointing at something the other device
    // deleted
    const kept = metadata.filter((meta) => files[meta.path] !== undefined);
    if (kept.length) {
      await this.fs.writeFile(metadataPath, JSON.stringify(kept), {
        createParents: true,
      });
    }

    await this.fs.flush();
  }

  /**
   * Let the editor say where its copies of files live.
   *
   * A registry rather than an event, because a caller that has just rewritten
   * files needs the buffers updated *before* it goes on -- sync holds pushes
   * until the editor agrees with the store, and an event gives it nothing to
   * wait on.
   */
  static registerEditorBuffers(buffers: EditorBuffers): Disposable {
    this._editorBuffers = buffers;
    return {
      dispose: () => {
        if (this._editorBuffers === buffers) this._editorBuffers = null;
      },
    };
  }

  /** The editor's buffers, or `null` when no editor is mounted */
  static get editorBuffers(): EditorBuffers | null {
    return this._editorBuffers;
  }

  /**
   * Rename a workspace, the current one unless `opts.from` names another.
   *
   * Another one is renamed where it lies, without switching to it: sync
   * renames a project renamed on another device when it takes that device's
   * copy, and the project need not be the one the user is in.
   *
   * A temporary view (a repository, gist or docs link) renames in the stored
   * list, read again from the store, and only with `from`: the view has no
   * current workspace.
   *
   * @param newName new workspace name
   * @param opts -
   * - `from`: the workspace to rename; defaults to the current one
   * - `announce`: send `ON_DID_RENAME_WORKSPACE` with the renamed workspace's
   *   id, for a rename the user asked for
   */
  static async renameWorkspace(
    newName: string,
    opts?: { from?: string; announce?: boolean }
  ) {
    newName = newName.trim();
    if (!this.isWorkspaceNameValid(newName)) {
      throw new Error(PgWorkspace.errors.INVALID_NAME);
    }

    const from = opts?.from;
    if (from !== undefined && from !== this.currentWorkspaceName) {
      // A temporary view renames in the stored list, read again now: the one
      // it showed may be older than another tab's change, and saving it
      // would drop that change
      let list = this._workspace ?? (await this._readListForTemporaryView());
      if (!list?.allNames.includes(from)) {
        throw new Error(PgWorkspace.errors.NOT_FOUND);
      }
      if (list.allNames.includes(newName)) {
        throw new Error(PgWorkspace.errors.ALREADY_EXISTS);
      }

      const fromPath = PgCommon.joinPaths(this.PATHS.ROOT_DIR_PATH, from);
      const newPath = PgCommon.joinPaths(this.PATHS.ROOT_DIR_PATH, newName);
      await this.fs.rename(fromPath, newPath);
      // Whether this call renamed the list: only then is there a change to
      // undo and save. A re-read that failed, or a rename refused because the
      // list moved meanwhile, wrote nothing, and saving the list held here
      // would write an older copy over the store
      let renamed = false;
      try {
        // Once more after the move, so the list saved is the store's latest
        if (!this._workspace) list = await this._readStoredList();
        list.rename(newName, from);
        renamed = true;
        await this._saveList(list);
      } catch (e) {
        // Put back what moved, or the list names a directory that is gone
        if (renamed) list.rename(from, newName);
        await this.fs.rename(newPath, fromPath);
        // The rename's own error is the one rethrown; a failed save of the
        // restored list is reported beside it rather than lost. A project
        // opened meanwhile saved a list that never took the rename, so there
        // is nothing to restore
        const isOvertaken = !!this._workspace && list !== this._workspace;
        if (renamed && !isOvertaken) {
          await this._saveList(list).catch((saveError: unknown) =>
            report("save workspaces after a failed rename", saveError)
          );
        }
        throw e;
      }
      // The list's own event, unconditional: the project list must follow a
      // rename sync made, which `ON_DID_RENAME_WORKSPACE` must not carry
      PgCommon.createAndDispatchCustomEvent(
        this.events.ON_DID_CHANGE_WORKSPACE_LIST
      );
      // Announced only when the user asked for it, and with the renamed
      // workspace's id: a listener that took it as a rename of the current
      // workspace flagged the open project dirty for a rename it never had.
      // A rename sync made to follow another device is not announced at all.
      if (opts?.announce) {
        PgCommon.createAndDispatchCustomEvent(
          this.events.ON_DID_RENAME_WORKSPACE,
          // From the list renamed in: a temporary view holds no other
          { id: list.idOf(newName) }
        );
      }
      return;
    }

    const workspacePath = this.getRequiredCurrentWorkspacePath();
    if (this.allWorkspaceNames!.includes(newName)) {
      throw new Error(PgWorkspace.errors.ALREADY_EXISTS);
    }

    // Rename workspace folder
    const newPath = workspacePath.replace(this.currentWorkspaceName!, newName);
    await this.renameItem(workspacePath, newPath, { skipNameValidation: true });

    // Rename workspace in state
    this._workspace!.rename(newName);

    await this.switchWorkspace(newName);

    PgCommon.createAndDispatchCustomEvent(this.events.ON_DID_RENAME_WORKSPACE);
  }

  /**
   * Delete a workspace and everything in it.
   *
   * @param name the workspace to delete; defaults to the current one
   * @throws if there is no list to delete from (no workspace and no
   * temporary view's stored list), if `name` is omitted and no workspace is
   * open (always so in a temporary view), or if `name` is not on the list
   *
   * A temporary view (a repository, gist or docs link) deletes from the
   * stored list the project list shows. None of those projects is open, so
   * the link's files stay open.
   *
   * Deleting a workspace the user is not in leaves them where they are — the
   * switch below would otherwise discard unsaved editor state in the project
   * they are actually working on, to remove a different one.
   */
  static async deleteWorkspace(name?: string) {
    // A temporary view deletes from the stored list, read again now as in
    // `renameWorkspace`; the view itself stays open
    let workspace = this._workspace ?? (await this._readListForTemporaryView());
    if (!workspace) throw new Error(PgWorkspace.errors.NOT_FOUND);
    const workspaceName = name ?? this.currentWorkspaceName;
    if (!workspaceName) throw new Error(PgWorkspace.errors.CURRENT_NOT_FOUND);
    if (!workspace.allNames.includes(workspaceName)) {
      throw new Error(PgWorkspace.errors.NOT_FOUND);
    }

    const isCurrent = workspaceName === this.currentWorkspaceName;
    const workspacePath = PgCommon.joinPaths(
      PgExplorer.PATHS.ROOT_DIR_PATH,
      PgCommon.appendSlash(workspaceName)
    );

    // Delete from `indexedDB`. A folder already gone (a delete that removed
    // the files and failed before saving, or a workspace another build listed)
    // is no reason to keep its name: the name is what the user asked to drop
    try {
      if (this._workspace) {
        await this.deleteItem(workspacePath);
      } else {
        // `deleteItem` acts on the open files alone in a temporary view
        await this.fs.removeDir(workspacePath, { recursive: true });
        await this._saveTree("a delete");
      }
    } catch (e) {
      if (!isMissing(e)) throw e;
      report("delete a workspace whose folder is gone", e);
    }

    // Once more after the removal, so the list saved is the store's latest.
    // A project opened from the list meanwhile holds the list now: the folder
    // is gone, so its name goes from that one
    if (!this._workspace) workspace = await this._readStoredList();
    else workspace = this._workspace;

    // Delete from state
    workspace.delete(workspaceName);

    if (!this._workspace) {
      // The project open before the link may be the one deleted: another
      // stays current, so leaving the link opens it rather than nothing
      const last = workspace.allNames.at(-1);
      if (!workspace.currentName && last) workspace.setCurrentName(last);
      await this._saveList(workspace);
    } else if (!isCurrent) {
      await this._saveWorkspaces();
    } else if (workspace.allNames.length) {
      const lastWorkspace = workspace.allNames.at(-1)!;
      await this.switchWorkspace(lastWorkspace);
    } else {
      workspace.setCurrent({ workspaces: [] });
      await this._saveWorkspaces();
      PgCommon.createAndDispatchCustomEvent(
        this.events.ON_DID_SWITCH_WORKSPACE
      );
    }

    PgCommon.createAndDispatchCustomEvent(this.events.ON_DID_DELETE_WORKSPACE);
  }

  /**
   * Saves file metadata to `indexedDB`
   *
   * NOTE: Only runs when the project is not temporary. Saves nothing when the
   * current workspace's folder is gone, and never makes it again.
   */
  static async saveMeta() {
    if (this.isTemporary) return;

    const paths = Object.keys(this.files);
    if (!paths.length) return;

    // Nothing is current, so there is nowhere for this to go. `deleteWorkspace`
    // removes the workspace from state and only then moves to another one, so
    // `switchWorkspace` -- which saves metadata first -- runs inside a window
    // where the explorer holds workspaces and none of them is current.
    //
    // Upstream passed through that window by accident: the pointer was a name,
    // so it went on naming the workspace just deleted and the check below
    // rejected it as an invalid state. The pointer is an id now and resolves
    // through the list, so the same window answers "no current workspace" and
    // the required-path getter threw -- leaving the explorer wedged with
    // workspaces it could not render, which is what `Folders` fell over on.
    // The file map at that point holds the deleted workspace's paths, so the
    // check below is what would have rejected them anyway.
    const workspacePath = this.getCurrentWorkspacePath();
    if (!workspacePath) return;
    const isInvalidState = paths.some(
      (path) => !path.startsWith(workspacePath)
    );
    if (isInvalidState) return;

    const metaFile = paths
      .reduce((acc, path) => {
        // Only save the files in the current workspace
        if (path.startsWith(workspacePath)) {
          acc.push({
            path,
            isTabs: this.tabs.includes(path),
            isCurrent: this.currentFilePath === path,
            position: this.files[path].meta?.position,
          });
        }

        return acc;
      }, [] as ItemMetaFile)
      .sort((a, b) => {
        // Sort based on tab order
        if (!a.isTabs) return 1;
        if (!b.isTabs) return -1;
        return this.tabs.indexOf(a.path) - this.tabs.indexOf(b.path);
      })
      .map((meta) => ({ ...meta, path: this.getRelativePath(meta.path) }));

    // Through `writeWorkspaceFile`: the write that creates this file changes
    // the folder tree (a new workspace, or one whose files sync replaced), and
    // a workspace whose folder is gone must not get it back
    try {
      await writeWorkspaceFile(
        PgWorkspace.METADATA_PATH,
        JSON.stringify(metaFile)
      );
    } catch (e) {
      if (!isMissing(e)) throw e;
      // Deleted or renamed in another tab, which this one has not yet heard
      // of: there is nothing to save to, and the switch that follows a save
      // must still be able to leave
      log.debug("no metadata saved: the workspace's folder is gone", {
        context: { workspacePath },
      });
    }
  }

  /**
   * Save the folder tree now rather than 500 ms after the last write, after a
   * change to the tree a reload must not lose.
   *
   * A failed save is reported and does not fail the caller: the change itself
   * is on disk, and failing would leave the state behind the store. The tree
   * is still saved on lightning-fs's own schedule.
   *
   * @param what the change, for the report ("a rename")
   */
  private static async _saveTree(what: string) {
    try {
      await this.fs.flush();
    } catch (e) {
      report(`save the folder tree after ${what}`, e);
    }
  }

  /* ----------------------------- State methods ---------------------------- */

  /**
   * The current project's files in the explorer's file map: workspace-relative
   * paths to contents, folders left out. Holds no dot-prefixed file, so not
   * the generated ones sync carries; `_syncedProjectFiles` adds those.
   * `checkProjectLimits` drops the paths sync does not carry.
   */
  private static _projectFiles(): Record<string, string> {
    // No prototype, as in `checkProjectLimits`: a root file named
    // `__proto__` would otherwise go to the inherited setter, not the map
    const files: Record<string, string> = Object.create(null);
    for (const [path, item] of Object.entries(this.files)) {
      if (item.content === undefined) continue;
      files[this.getRelativePath(path)] = item.content;
    }
    return files;
  }

  /**
   * `_projectFiles` plus every file sync carries that only the store has.
   * `isItemNameValid` keeps dot-named entries out of the explorer's file map,
   * yet sync and the server count them toward the project's size: the
   * `SYNCED_WORKSPACE_FILES`, and a user's `.gitignore` or `.github/` that an
   * import or another device wrote. Only those files are read; the rest come
   * from memory. A temporary project has no store and none of them.
   */
  private static async _syncedProjectFiles(): Promise<Record<string, string>> {
    const files = this._projectFiles();
    const workspacePath = this.getCurrentWorkspacePath();
    if (this.isTemporary || !workspacePath) return files;

    const root = PgCommon.appendSlash(workspacePath);
    const walk = async (dir: string): Promise<void> => {
      let names: string[];
      try {
        names = await this.fs.readDir(dir);
      } catch (e) {
        // Not written yet: nothing to count
        if (isMissing(e)) return;
        throw e;
      }
      for (const name of names) {
        const path = PgCommon.joinPaths(dir, name);
        const relative = path.slice(root.length);
        if (!isSyncedPath(relative)) continue;
        if ((await this.fs.getMetadata(path)).isDirectory()) {
          await walk(path);
        } else if (!(relative in files)) {
          files[relative] = await this.fs.readToString(path);
        }
      }
    };
    await walk(workspacePath);
    return files;
  }

  /**
   * A path `createWorkspace` was given, relative to the workspace `name`.
   * Callers pass both `/name/src/lib.rs` and `src/lib.rs`.
   */
  private static _workspaceRelative(name: string, path: string) {
    const root = PgCommon.joinPaths(
      this.PATHS.ROOT_DIR_PATH,
      PgCommon.appendSlash(name)
    );
    if (path.startsWith(root)) return path.slice(root.length);
    return path.replace(/^\//, "");
  }

  /**
   * Refuse a write whose project would be over `limit`, before anything is
   * written. Every create, rename and import comes through the three methods
   * that call this, so the New File dialog, the assistant's file writes, the
   * terminal commands and the import flows all get the same refusal. The
   * editor's saves and sync's restores do not: a refused autosave would lose
   * typing, and a refused restore would strand a project stored over a limit
   * after a later change to one; the sync banner reports both.
   *
   * The message is the limit's rule, or for an import, what is over it and
   * the rule, since the files were not the user's last keystroke.
   */
  private static _refuseOverLimit(
    action: LimitActionParam,
    limit: ProjectLimitExceeded | null
  ) {
    if (!limit) return;
    explorerTelemetry.track("explorer_limit_refused", {
      action,
      limit: limitKind(limit),
    });
    throw new ExplorerLimitError(
      limit,
      action === "import" ? limitSummary(limit) : limitRule(limit)
    );
  }

  /**
   * Get all files as `TupleFiles`
   *
   * @returns all files as an array of [path, content] tuples
   */
  static getAllFiles() {
    return this._convertToTupleFiles(this.files);
  }

  /**
   * Save the file to the state only.
   *
   * @param path file path
   * @param content file content
   */
  static saveFileToState(path: string, content: string) {
    path = this.convertToFullPath(path);
    if (!this.files[path]) return;

    this.files[path].content = content;
    // The only signal that a file's *contents* changed. `onDidCreateItem` and
    // friends cover the tree's shape, and nothing covered an edit -- so
    // anything mirroring the workspace had no way to know it had gone stale.
    // Dispatched from here rather than from the editor because this is what
    // `getAllFiles` reads, so a listener is guaranteed to see the new content.
    PgCommon.createAndDispatchCustomEvent(this.events.ON_DID_SAVE_FILE);
  }

  /**
   * Get the full file data.
   *
   * @param path path of the file, defaults to the current file if it exists
   */
  static getFile(path: string): FullFile | null {
    path = this.convertToFullPath(path);
    const itemInfo = this.files[path];
    if (itemInfo) return { path, ...this.files[path] };
    return null;
  }

  /**
   * Get file content from state.
   *
   * @param path file path
   * @returns the file content from state
   */
  static getFileContent(path: string) {
    return this.getFile(path)?.content;
  }

  /**
   * Get the item names from inside the given folder and group them into
   * `files` and `folders`.
   *
   * @param path folder path
   * @returns the groupped folder items
   */
  static getFolderContent(path: string) {
    path = PgCommon.appendSlash(PgExplorer.convertToFullPath(path));

    const files = this.files;
    const filesAndFolders: Folder = { folders: [], files: [] };

    for (const itemPath in files) {
      if (itemPath.startsWith(path)) {
        const item = itemPath.split(path)[1].split("/")[0];
        if (
          !filesAndFolders.files.includes(item) &&
          !filesAndFolders.folders.includes(item) &&
          item
        ) {
          // It's a file if it contains '.'
          // TODO: Implement a better system for folders and files
          if (item.includes(".")) filesAndFolders.files.push(item);
          else filesAndFolders.folders.push(item);
        }
      }
    }

    return filesAndFolders;
  }

  /**
   * Get the current open file from state if it exists.
   *
   * @returns the current file
   */
  static getCurrentFile() {
    if (this.currentFilePath) return this.getFile(this.currentFilePath);
    return null;
  }

  /**
   * Get the current file's language from it's path.
   *
   * @returns the current language name
   */
  static getCurrentFileLanguage() {
    if (this.currentFilePath) {
      return PgLanguage.getFromPath(this.currentFilePath);
    }
  }

  /**
   * Get whether current file is a regular JS/TS or test JS/TS file.
   *
   * @returns whether the current file is a JavaScript-like file
   */
  static isCurrentFileJsLike() {
    if (this.currentFilePath) {
      return PgLanguage.getIsPathJsLike(this.currentFilePath);
    }
  }

  /**
   * Open the file at the given path.
   *
   * This method mutates the existing tabs array.
   *
   * @param path file path
   */
  static openFile(path: string) {
    path = this.convertToFullPath(path);

    // Return if it's already the current file
    if (this.currentFilePath === path) return;

    // Add to tabs if it hasn't yet been added
    if (!this.tabs.includes(path)) this._explorer.tabs.push(path);

    // Update the current file index
    this._explorer.currentIndex = this.tabs.indexOf(path);

    PgCommon.createAndDispatchCustomEvent(
      this.events.ON_DID_OPEN_FILE,
      this.getCurrentFile()
    );
  }

  /**
   * Close the file at the given path.
   *
   * This method mutates the existing tabs array. A path with no tab is left
   * alone, and no close event is dispatched for it.
   *
   * @param path file path
   */
  static closeFile(path: string) {
    path = this.convertToFullPath(path);

    // Without this, `indexOf` gives -1 and `splice(-1, 1)` below removes the
    // last tab, an unrelated one
    if (!this.tabs.includes(path)) return;

    // If closing the current file, change the current file to the next tab
    if (this.currentFilePath === path) {
      const pathToOpen =
        this.tabs.at(this._currentIndex + 1) ?? this.tabs.at(-2);
      if (pathToOpen) this.openFile(pathToOpen);
    }

    // Update tabs and the current index
    //
    // NOTE: This is actually required to be stored because removing the tab
    // may make `this.currentFilePath` `undefined`, which then makes the current
    // index `-1`. Custom getter is the source of the problem, as it makes it
    // hard to spot when the value changed.
    const currentFilePath = this.currentFilePath;
    if (currentFilePath) {
      this._explorer.tabs.splice(this.tabs.indexOf(path), 1);
      this._explorer.currentIndex = this.tabs.indexOf(currentFilePath);
    }

    PgCommon.createAndDispatchCustomEvent(this.events.ON_DID_CLOSE_FILE);
  }

  /**
   * Set the tab paths without duplication.
   *
   * @param tabs tab paths to set
   */
  static setTabs(tabs: readonly string[]) {
    const currentPath = this.currentFilePath;
    this._explorer.tabs = [...new Set(tabs)];
    if (currentPath) {
      this._explorer.currentIndex = this.tabs.indexOf(currentPath);
    }

    PgCommon.createAndDispatchCustomEvent(this.events.ON_DID_SET_TABS);
  }

  /**
   * Get the position data for the file from state.
   *
   * @param path file path
   * @returns the file's position data
   */
  static getEditorPosition(path: string): Position {
    return (
      this.getFile(path)?.meta?.position ?? {
        cursor: { from: 0, to: 0 },
        topLineNumber: 1,
      }
    );
  }

  /**
   * Save editor position data to state.
   *
   * @param path file path
   * @param position position data
   */
  static saveEditorPosition(path: string, position: Position) {
    // The editor saves every second, and a workspace being re-read (Start in
    // a tutorial switches it) has emptied the file map: nothing to keep then
    const file = this.files[this.convertToFullPath(path)];
    if (!file) return;

    file.meta ??= {};
    file.meta.position = position;
  }

  /**
   * Set the current workspace name.
   *
   * @param name workspace name
   */
  static setWorkspaceName(name: string) {
    this._workspace!.setCurrentName(name);
  }

  /**
   * Get the path without the workspace path prefix.
   *
   * @param fullPath full path
   * @returns the relative path
   */
  static getRelativePath(fullPath: string) {
    // /src/lib.rs -> src/lib.rs
    if (PgExplorer.isTemporary) return fullPath.substring(1);

    // /name/src/lib.rs -> src/lib.rs
    return fullPath.replace(this.getRequiredCurrentWorkspacePath(), "");
  }

  /**
   * Get the canonical path, i.e. the full path from the project root and
   * directory paths end with `/`.
   *
   * @param path item path
   * @returns the canonical path
   */
  static getCanonicalPath(path: string) {
    path = PgExplorer.convertToFullPath(path);
    if (PgExplorer.getItemTypeFromPath(path).file) return path;
    return PgCommon.appendSlash(path);
  }

  // TODO: Path module
  /**
   * Convert the given path to a full path.
   *
   * @param path path to convert
   * @returns the full path
   */
  static convertToFullPath(path: string) {
    // Return absolute path
    if (path.startsWith(this.PATHS.ROOT_DIR_PATH)) return path;

    // Convert to absolute path if it doesn't start with '/'
    return PgCommon.joinPaths(this.getProjectRootPath(), path);
  }

  /**
   * Get the current project root path.
   *
   * This is not to be confused with root path(`/`).
   *
   * @returns the current project root path
   */
  static getProjectRootPath() {
    if (this.isTemporary) return this.PATHS.ROOT_DIR_PATH;
    return this.getRequiredCurrentWorkspacePath();
  }

  /**
   * Get the current `src` directory path.
   *
   * @returns the current `src` directory path with `/` appended
   */
  static getCurrentSrcPath() {
    const srcPath = PgCommon.joinPaths(
      this.getProjectRootPath(),
      this.PATHS.SRC_DIRNAME
    );
    return PgCommon.appendSlash(srcPath);
  }

  /**
   * Get full path of current workspace (`/` appended), or `null` if not in a
   * workspace.
   *
   * @returns the workspace path
   */
  static getCurrentWorkspacePath() {
    if (!this.currentWorkspaceName) return null;

    return PgCommon.joinPaths(
      PgExplorer.PATHS.ROOT_DIR_PATH,
      PgCommon.appendSlash(this.currentWorkspaceName)
    );
  }

  /**
   * Get full path of current workspace (`/` appended).
   *
   * @throws if not currently in a workspace
   * @returns the workspace path
   */
  static getRequiredCurrentWorkspacePath() {
    if (!this._workspace) {
      throw new Error(PgWorkspace.errors.NOT_FOUND);
    }
    if (!this.currentWorkspaceName) {
      throw new Error(PgWorkspace.errors.CURRENT_NOT_FOUND);
    }

    // Previous checks guarantee definition
    return this.getCurrentWorkspacePath()!;
  }

  /* --------------------------- Change listeners --------------------------- */

  /**
   * Runs after explorer state has changed and the UI needs to re-render.
   *
   * @param cb callback function to run
   * @returns a dispose function to clear the event
   */
  static onNeedRender(cb: () => unknown) {
    return PgCommon.batchChanges(cb, [
      PgExplorer.onDidInit,
      PgExplorer.onDidCreateItem,
      PgExplorer.onDidDeleteItem,
      PgExplorer.onDidOpenFile,
      PgExplorer.onDidCloseFile,
    ]);
  }

  /**
   * Runs after explorer has been initialized.
   *
   * @param cb callback function to run
   * @returns a dispose function to clear the event
   */
  static onDidInit(cb: () => unknown) {
    return PgCommon.onDidChange(PgExplorer.events.ON_DID_INIT, cb);
  }

  /**
   * Runs after creating a new item.
   *
   * @param cb callback function to run
   * @returns a dispose function to clear the event
   */
  static onDidCreateItem(cb: () => unknown) {
    return PgCommon.onDidChange(PgExplorer.events.ON_DID_CREATE_ITEM, cb);
  }

  /**
   * Runs before renaming an item, once the rename has passed its checks.
   *
   * @param cb receives the item's full path before the rename (a folder's, for
   * a folder). It is not awaited: only its synchronous part runs first
   * @returns a dispose function to clear the event
   */
  static onWillRenameItem(cb: (path: string) => unknown) {
    return PgCommon.onDidChange(PgExplorer.events.ON_WILL_RENAME_ITEM, cb);
  }

  /**
   * Runs after renaming an item.
   *
   * @param cb callback function to run
   * @returns a dispose function to clear the event
   */
  static onDidRenameItem(cb: (path: string) => unknown) {
    return PgCommon.onDidChange(PgExplorer.events.ON_DID_RENAME_ITEM, cb);
  }

  /**
   * Runs after renaming or moving an item, with its full path before and
   * after: what a listener that keeps state per path needs to carry it over.
   *
   * @param cb callback function to run
   * @returns a dispose function to clear the event
   */
  static onDidMoveItem(cb: (move: { from: string; to: string }) => unknown) {
    return PgCommon.onDidChange(PgExplorer.events.ON_DID_MOVE_ITEM, cb);
  }

  /**
   * Runs after deleting an item.
   *
   * @param cb callback function to run
   * @returns a dispose function to clear the event
   */
  /**
   * Runs after a file's contents change.
   *
   * @param cb callback function to run
   * @returns a dispose function to clear the event
   */
  static onDidSaveFile(cb: () => unknown) {
    return PgCommon.onDidChange(PgExplorer.events.ON_DID_SAVE_FILE, cb);
  }

  /**
   * Runs after the current workspace's contents are taken from the store: what
   * another tab wrote. Not a save, so it schedules no upload of what that tab
   * already uploaded.
   *
   * @param cb callback function to run
   * @returns a dispose function to clear the event
   */
  static onDidReloadFiles(cb: () => unknown) {
    return PgCommon.onDidChange(PgExplorer.events.ON_DID_RELOAD_FILES, cb);
  }

  static onDidDeleteItem(cb: (path: string) => unknown) {
    return PgCommon.onDidChange(PgExplorer.events.ON_DID_DELETE_ITEM, cb);
  }

  /**
   * Runs after switching to a different file.
   *
   * @param cb callback function to run
   * @returns a dispose function to clear the event
   */
  static onDidOpenFile(cb: (file: FullFile | null) => unknown) {
    return PgCommon.onDidChange(PgExplorer.events.ON_DID_OPEN_FILE, cb, {
      value: PgExplorer.getCurrentFile(),
    });
  }

  /**
   * Runs after closing a file.
   *
   * @param cb callback function to run
   * @returns a dispose function to clear the event
   */
  static onDidCloseFile(cb: () => unknown) {
    return PgCommon.onDidChange(PgExplorer.events.ON_DID_CLOSE_FILE, cb);
  }

  /**
   * Runs after setting tabs.
   *
   * @param cb callback function to run
   * @returns a dispose function to clear the event
   */
  static onDidSetTabs(cb: () => unknown) {
    return PgCommon.onDidChange(PgExplorer.events.ON_DID_SET_TABS, cb);
  }

  /**
   * Runs after creating a workspace, or importing one from the account.
   *
   * @param cb callback function to run
   * @returns a dispose function to clear the event
   */
  static onDidCreateWorkspace(cb: (created: CreatedWorkspace) => unknown) {
    return PgCommon.onDidChange(PgExplorer.events.ON_DID_CREATE_WORKSPACE, cb);
  }

  /**
   * Runs when the list of workspaces changed without its own event: another
   * tab's list taken by `refreshWorkspaces`, or a workspace that is not the
   * current one renamed where it lies, which sync does unannounced.
   *
   * @param cb callback function to run
   * @returns a dispose function to clear the event
   */
  static onDidChangeWorkspaceList(cb: () => unknown) {
    return PgCommon.onDidChange(
      PgExplorer.events.ON_DID_CHANGE_WORKSPACE_LIST,
      cb
    );
  }

  /**
   * Runs after renaming a workspace.
   *
   * @param cb callback function to run
   * @returns a dispose function to clear the event
   */
  /**
   * @param cb receives the renamed workspace's id when it was not the current
   * one, and nothing for a rename of the current workspace
   */
  static onDidRenameWorkspace(cb: (renamed?: { id?: string }) => unknown) {
    return PgCommon.onDidChange(PgExplorer.events.ON_DID_RENAME_WORKSPACE, cb);
  }

  /**
   * Runs after deleting a workspace.
   *
   * @param cb callback function to run
   * @returns a dispose function to clear the event
   */
  static onDidDeleteWorkspace(cb: () => unknown) {
    return PgCommon.onDidChange(PgExplorer.events.ON_DID_DELETE_WORKSPACE, cb);
  }

  /**
   * Runs after switching to a different workspace.
   *
   * @param cb callback function to run
   * @returns a dispose function to clear the event
   */
  static onDidSwitchWorkspace(cb: () => unknown) {
    return PgCommon.onDidChange(PgExplorer.events.ON_DID_SWITCH_WORKSPACE, cb);
  }

  /* ---------------------------- Private methods --------------------------- */

  /**
   * Initialize explorer with the current workspace.
   *
   * Only the current workspace at a time will be in the memory.
   */
  private static async _initCurrentWorkspace() {
    // No workspace to open is a state, not a fault: the recovery below resets
    // to none when the config named workspaces the filesystem does not have,
    // and then calls back into here. Demanding one turned that rescue into
    // "Current workspace not found" -- the same failure it was recovering
    // from, now with nothing left to recover. `init` reaches the identical
    // end state by its own route when there are no workspaces at all, and
    // `Flow` answers it by offering to make one.
    const workspacePath = this.getCurrentWorkspacePath();
    if (!workspacePath) {
      this._explorer = this._getDefaultState();
      return;
    }

    const workspace = this._workspace!;

    // Reset files
    this._explorer.files = {};

    // Sets up the files from `indexedDB` to the state
    const setupFiles = async (path: string) => {
      const itemNames = await this.fs.readDir(path);

      // Empty directory
      if (!itemNames.length) {
        this.files[path] = {};
        return;
      }

      const subItemPaths = itemNames
        .filter(PgExplorer.isItemNameValid)
        .map((itemName) => {
          return PgExplorer.getCanonicalPath(
            PgCommon.joinPaths(path, itemName)
          );
        });
      for (const subItemPath of subItemPaths) {
        const metadata = await this.fs.getMetadata(subItemPath);
        if (metadata.isFile()) {
          try {
            // This might fail if the user closes the window when a file delete
            // operation has not been completed yet
            const content = await this.fs.readToString(subItemPath);
            this.files[subItemPath] = { content };
          } catch (e: any) {
            log.warn(`Couldn't read to string: ${e.message} ${subItemPath}`);
          }
        } else {
          await setupFiles(subItemPath);
        }
      }
    };

    try {
      await setupFiles(workspacePath);
    } catch (e: any) {
      log.warn(`Couldn't setup files: ${e.message}`);

      // The most likely cause for `setupFiles` failure is if the current
      // workspace doesn't exist in the filesystem but it's saved as the
      // current workspace. To fix this, set the current workspace name to
      // either the last workspace, or reset all workspaces in the case of no
      // valid workspace directory in `/`.
      if (workspace.allNames.length) {
        const rootDirs = await this.fs.readDir(PgExplorer.PATHS.ROOT_DIR_PATH);
        const workspaceDirs = rootDirs.filter(PgExplorer.isItemNameValid);
        if (!workspaceDirs.length) {
          // Reset workspaces since there is no workspace directories
          this._workspace = new PgWorkspace();
        } else {
          // Remove the current workspace.
          //
          // NOTE: Intentionally avoiding using `this.deleteWorkspace`, in order
          // to keep the files in case we want to recover in the future.
          if (workspace.currentName) workspace.delete(workspace.currentName);

          // Switch to the last available workspace
          const lastWorkspaceName = workspaceDirs.at(-1)!;
          workspace.setCurrentName(lastWorkspaceName);
        }

        await this._saveWorkspaces();
        await this._initCurrentWorkspace();
        return;
      }

      log.info("No workspace found. Most likely needs initial setup.");
    }

    // Runs when `indexedDB` is empty
    if (!Object.keys(this.files).length && !this.allWorkspaceNames?.length) {
      log.info("Setting up default FS...");
      // For backwards compatibility reasons, we check whether explorer key is used in localStorage
      // and move the localStorage FS to `indexedDB`.
      // TODO: delete this check after moving domains
      const lsExplorerStr = localStorage.getItem("explorer");
      if (lsExplorerStr) {
        // Create a default workspace
        workspace.create(PgWorkspace.DEFAULT_WORKSPACE_NAME);
        // Save workspaces
        await this._saveWorkspaces();

        const lsExplorer: Explorer = JSON.parse(lsExplorerStr);
        const lsFiles = lsExplorer.files;
        for (const path in lsFiles) {
          const oldData = lsFiles[path];
          delete lsFiles[path];
          lsFiles[path.replace(PgExplorer.PATHS.ROOT_DIR_PATH, workspacePath)] =
            {
              content: oldData.content,
              // @ts-ignore // ignoring because the type of oldData changed
              meta: { current: oldData.current, tabs: oldData.tabs },
            };
        }
        this._explorer.files = lsFiles;
      } else {
        // There are no files in state and `indexedDB`
        // return and show create a project option
        return;
      }

      // Save file(s) to `indexedDB`
      await this._writeAllFromState();

      // Create tab info file
      await this.saveMeta();
    }

    // Load metadata info from `indexedDB`
    let metaFile = await this.fs.readToJSONOrDefault<ItemMetaFile>(
      PgWorkspace.METADATA_PATH,
      []
    );

    // Convert the old metadata file
    // TODO: Delete in 2024
    if (!Array.isArray(metaFile)) {
      type OldItemMetaFile = Record<
        string,
        {
          current?: boolean;
          tabs?: boolean;
          position?: Position;
        }
      >;

      const oldMetaFile = metaFile as OldItemMetaFile;
      metaFile = [];
      for (const path in oldMetaFile) {
        const meta = oldMetaFile[path];
        metaFile.push({
          path,
          isTabs: meta.tabs,
          isCurrent: meta.current,
          position: meta.position,
        });
      }
    }

    // Metadata file paths are relative, convert to full path
    const fullPathMetaFile = metaFile.map((meta) => ({
      ...meta,
      path: this.convertToFullPath(meta.path),
    }));

    // Tabs
    const tabs = fullPathMetaFile
      .filter((meta) => meta.isTabs)
      .map((meta) => meta.path);
    this.setTabs(tabs);

    // Current
    const current = fullPathMetaFile.find((meta) => meta.isCurrent);
    this._explorer.currentIndex = current
      ? this.tabs.indexOf(current.path)
      : -1;

    // Nothing to show. The metadata is what remembers which file was open, so
    // a workspace that has never had one -- or whose metadata did not survive
    // having its files replaced from another device -- opens with an empty
    // editor over a full file tree, and stays that way until the user clicks
    // something. Falling back to the same default a new project gets means
    // re-reading a workspace always lands somewhere.
    if (this._explorer.currentIndex === -1) {
      const defaultOpenFile = this._getDefaultOpenFile(this.files);
      if (defaultOpenFile) this.openFile(defaultOpenFile);
    }

    // Metadata
    for (const itemMeta of fullPathMetaFile) {
      const file = this.files[itemMeta.path];
      if (file?.content !== undefined) {
        file.meta = { position: itemMeta.position };
      }
    }
  }

  /** Write all state data to `indexedDB`. */
  private static async _writeAllFromState() {
    for (const path in this.files) {
      const itemType = PgExplorer.getItemTypeFromPath(path);
      if (itemType.file) {
        await this.fs.writeFile(path, this.files[path].content ?? "", {
          createParents: true,
        });
      } else {
        await this.fs.createDir(path, { createParents: true });
      }
    }
  }

  /**
   * Read workspaces config from `indexedDB`.
   *
   * @returns the workspaces state
   */
  private static async _getWorkspaces() {
    // Migrated here rather than at each call site: this is the only door the
    // on-disk shape comes through, and every existing user still has the
    // pre-id one. `migrate` is idempotent, so a migrated config passes
    // straight through.
    return PgWorkspace.migrate(
      await this.fs.readToJSONOrDefault(
        PgWorkspace.WORKSPACES_CONFIG_PATH,
        PgWorkspace.DEFAULT
      )
    );
  }

  /**
   * Initialize workspaces from `indexedDB` to state.
   *
   * @returns the workspaces now in memory
   */
  private static async _initWorkspaces() {
    const workspaces = await this._getWorkspaces();
    const workspace = (this._workspace ??= new PgWorkspace());
    workspace.setCurrent(workspaces);
    // Read for a temporary view, which this one replaces
    this._storedList = undefined;
    await this._saveWorkspaces();
    return workspace;
  }

  /**
   * Read the stored workspaces for a temporary view, leaving `_workspace`
   * empty; announces a list that changed, which the project list shows.
   *
   * @returns the stored workspaces
   */
  private static async _readStoredList() {
    return this._takeStoredList(await this._fetchStoredList());
  }

  /** The stored workspaces, read without setting them as the shown list */
  private static async _fetchStoredList() {
    // Strict, unlike `_getWorkspaces`: a config that cannot be read must not
    // read as no projects, nor be written back as an empty list
    let read: Parameters<typeof PgWorkspace.migrate>[0];
    try {
      read = await this.fs.readToJSON(PgWorkspace.WORKSPACES_CONFIG_PATH);
    } catch (e) {
      if (!isMissing(e)) throw e;
      read = PgWorkspace.DEFAULT;
    }
    return new PgWorkspace(PgWorkspace.migrate(read));
  }

  /** Set the stored list a temporary view shows; announce it if it changed */
  private static _takeStoredList(stored: PgWorkspace) {
    const isChanged =
      JSON.stringify(stored.allNames) !==
      JSON.stringify(this._storedList?.allNames);
    this._storedList = stored;
    if (isChanged) {
      PgCommon.createAndDispatchCustomEvent(
        this.events.ON_DID_CHANGE_WORKSPACE_LIST
      );
    }
    return stored;
  }

  /** The stored list for a change made from a temporary view, else none */
  private static async _readListForTemporaryView() {
    return this.isTemporary ? await this._readStoredList() : undefined;
  }

  /**
   * Save the list a change was made in: the workspaces in memory, or the
   * stored list a temporary view read for it. Through `_saveWorkspaces`, the
   * one writer of the workspaces config; the list is set as the stored one
   * right before, with no await between, so a read meanwhile cannot swap it
   */
  private static async _saveList(list: PgWorkspace) {
    if (list !== this._workspace) {
      // A project opened from the list while this change ran: the list in
      // memory, not the one changed, is what a save writes now, so the
      // change is refused and its caller puts the folder back
      if (this._workspace) throw new Error(PgWorkspace.errors.LIST_CHANGED);
      this._storedList = list;
    }
    await this._saveWorkspaces();
  }

  /**
   * Saves workspaces from state, or in a temporary view the stored list
   * (`_saveList`), to `indexedDB`.
   */
  private static async _saveWorkspaces() {
    const list = this._listOfStored;
    if (list) {
      // Recorded as saved once it has landed, not before. Until then the
      // store may still hold the old list -- or keep it, if the write fails
      // -- and recorded early, this tab's own change would read as the
      // store's at the next refresh, and be replaced by it.
      const saving = JSON.stringify(list.get().workspaces);
      await this.fs.writeFile(
        PgWorkspace.WORKSPACES_CONFIG_PATH,
        JSON.stringify(list.get()),
        { createParents: true }
      );

      // Every structural workspace change funnels through here (a temporary
      // view's through `_saveList`), and the backing store defers its directory-tree write by 500ms. Without this,
      // a reload in that window finds the config listing a workspace whose
      // directory was never persisted -- "No project", with the files still
      // on disk but unreachable.
      await this.fs.flush();
      // Only while memory still holds what was written: a later change has
      // a save of its own coming, and a refresh meanwhile has recorded what
      // it took
      if (JSON.stringify(list.get().workspaces) === saving) {
        this._savedWorkspaces = saving;
      }
    }
  }

  /**
   * Get the default explorer state.
   *
   * NOTE: This is intentionally a method instead of a property in order to create a
   * new object each time since explorer methods mutate the existing object.
   *
   * @returns the default explorer state
   */
  private static _getDefaultState(): Explorer {
    return {
      files: {},
      tabs: [],
      currentIndex: -1,
    };
  }

  /* ------------------------------- Utilities ------------------------------ */

  /** Paths */
  static readonly PATHS = {
    ROOT_DIR_PATH: "/",
    SRC_DIRNAME: "src",
    CLIENT_DIRNAME: "client",
    TESTS_DIRNAME: "tests",
    WORKSPACE_DIRNAME: ".workspace",
  };

  /**
   * Get item's name from its path.
   *
   * @param path item path
   * @returns the item name
   */
  static getItemNameFromPath(path: string) {
    const items = path.split("/");
    const name = path.endsWith("/") ? items.at(-2) : items.at(-1);
    return name!;
  }

  // TODO: Implement a better identifier
  /**
   * Get the item's type from its name.
   *
   * @param itemName item name
   * @returns the item type
   */
  static getItemTypeFromName(itemName: string) {
    if (itemName.includes(".")) return { file: true };
    return { folder: true };
  }

  /**
   * Get the item's type from its path.
   *
   * @param path item path
   * @returns the item type
   */
  static getItemTypeFromPath(path: string) {
    return PgExplorer.getItemTypeFromName(PgExplorer.getItemNameFromPath(path));
  }

  /**
   * Get the item's type from the given element.
   *
   * @param el item element
   * @returns the item type
   */
  static getItemTypeFromEl(el: HTMLDivElement) {
    const path = PgExplorer.getItemPathFromEl(el);
    if (path) return PgExplorer.getItemTypeFromPath(path);
  }

  /**
   * Get the item's path from the given element.
   *
   * @param el item element
   * @returns the item path
   */
  static getItemPathFromEl(el: Element) {
    return el?.getAttribute("data-path");
  }

  /**
   * Get the parent's path from the given path with `/` appended.
   *
   * @param path item path
   * @returns the parent path
   */
  static getParentPathFromPath(path: string) {
    const pad =
      this.getItemTypeFromPath(path).folder && path.endsWith("/") ? 2 : 1;

    const names = path.split("/");
    const parentPath = names
      .filter((_itemName, i) => i !== names.length - pad)
      .reduce((acc, itemName) => (acc += `/${itemName}`));

    return PgCommon.appendSlash(parentPath);
  }

  /**
   * Get the parent path from the given element.
   *
   * @param el item element
   * @returns the parent path
   */
  static getParentPathFromEl(el: HTMLDivElement) {
    const itemType = PgExplorer.getItemTypeFromEl(el);

    if (itemType?.folder) {
      return PgExplorer.getItemPathFromEl(el);
    } else if (itemType?.file) {
      // The file's owner folder is parent element's previous sibling
      return PgExplorer.getItemPathFromEl(
        el.parentElement!.previousElementSibling as HTMLDivElement
      );
    }
  }

  /**
   * Get the element from its path.
   *
   * @param path item path
   * @returns the element
   */
  static getElFromPath(path: string) {
    // A file name may hold a quote or a backslash, which would end the
    // selector's string or escape the next character
    const quoted = path.replace(/["\\]/g, "\\$&");
    return (document.querySelector(`[data-path="${quoted}"]`) ?? undefined) as
      | HTMLDivElement
      | undefined;
  }

  /** Get the root folder elemement. */
  static getRootFolderEl() {
    return document.getElementById(PgView.ids.ROOT_DIR);
  }

  /** Get the current selected element. */
  static getSelectedEl() {
    return document.getElementsByClassName(PgView.classNames.SELECTED)[0] as
      | HTMLDivElement
      | undefined;
  }

  /**
   * Set the current selected element.
   *
   * @param newEl new element to select
   */
  static setSelectedEl(newEl: HTMLDivElement) {
    PgExplorer.getSelectedEl()?.classList.remove(PgView.classNames.SELECTED);
    newEl.classList.add(PgView.classNames.SELECTED);
  }

  /** Get the selected context element. */
  static getCtxSelectedEl() {
    const ctxSelectedEls = document.getElementsByClassName(
      PgView.classNames.CTX_SELECTED
    );
    if (ctxSelectedEls.length) return ctxSelectedEls[0];
  }

  /** Set the selected context element. */
  static setCtxSelectedEl(newEl: HTMLDivElement) {
    PgExplorer.removeCtxSelectedEl();
    newEl.classList.add(PgView.classNames.CTX_SELECTED);
  }

  /** Remove the selected context element. */
  static removeCtxSelectedEl() {
    PgExplorer.getCtxSelectedEl()?.classList.remove(
      PgView.classNames.CTX_SELECTED
    );
  }

  /**
   * Open the given folder element.
   *
   * @param el folder element
   */
  static openFolder(el: HTMLDivElement) {
    // Folder icon
    el.classList.add(PgView.classNames.OPEN);

    // Toggle inside folder
    const insideFolderEl = el.nextElementSibling;
    if (insideFolderEl) {
      insideFolderEl.classList.remove(PgView.classNames.HIDDEN);
    }
  }

  /**
   * Toggle open/close state of the given folder element.
   *
   * @param el folder element
   */
  static toggleFolder(el: HTMLDivElement) {
    // Folder icon
    el.classList.toggle(PgView.classNames.OPEN);

    // Toggle inside folder
    const insideFolderEl = el.nextElementSibling;
    if (insideFolderEl)
      insideFolderEl.classList.toggle(PgView.classNames.HIDDEN);
  }

  /**
   * Recursively open all parent folders of the given path.
   *
   * @param path item path
   */
  static openAllParents(path: string) {
    for (;;) {
      const parentPath = this.getParentPathFromPath(path);
      const parentEl = this.getElFromPath(parentPath);
      if (!parentEl) break;

      this.openFolder(parentEl);
      if (parentPath === this.PATHS.ROOT_DIR_PATH) break;

      path = parentPath;
    }
  }

  /** Collapse all folders in the UI. */
  static collapseAllFolders() {
    // Close all folders
    const folderElements = document.getElementsByClassName(
      PgView.classNames.FOLDER
    );
    for (const folder of folderElements) {
      folder.classList.remove(PgView.classNames.OPEN);
    }

    // Hide all folder inside elements
    const insideElements = document.getElementsByClassName(
      PgView.classNames.FOLDER_INSIDE
    );
    for (const folderInside of insideElements) {
      folderInside.classList.add(PgView.classNames.HIDDEN);
    }
  }

  /**
   * Get whether the given name can be used for an item.
   *
   * @param name item name
   * @returns whether the item name is valid
   */
  static isItemNameValid(name: string) {
    return (
      /^(?![.])[\w\d.-/]+/.test(name) &&
      !name.includes("//") &&
      !name.includes("..") &&
      !name.endsWith("/") &&
      !name.endsWith(".")
    );
  }

  /**
   * Get whether the given name can be used for a workspace.
   *
   * @param name item name
   * @returns whether the workspace name is valid
   */
  static isWorkspaceNameValid(name: string) {
    return !!name.match(/^(?!\s)[\w\s-]+$/);
  }

  /* --------------------------- Private utilities -------------------------- */

  /**
   * Convert the given `ExplorerFiles` to `TupleFiles`.
   *
   * @returns all files as an array of [path, content] tuples
   */
  private static _convertToTupleFiles(explorerFiles: ExplorerFiles) {
    const tupleFiles: TupleFiles = [];
    for (const path in explorerFiles) {
      const content = explorerFiles[path].content;
      if (content !== undefined) tupleFiles.push([path, content]);
    }

    return tupleFiles;
  }

  /**
   * Convert the given `TupleFiles` to `ExplorerFiles`.
   *
   * @param tupleFiles tuple files to convert
   * @returns the converted `ExplorerFiles`
   */
  private static _convertToExplorerFiles(tupleFiles: TupleFiles) {
    const explorerFiles: ExplorerFiles = {};
    for (const [path, content] of tupleFiles) {
      const fullPath = PgCommon.joinPaths(PgExplorer.PATHS.ROOT_DIR_PATH, path);
      explorerFiles[fullPath] = { content };
    }

    return explorerFiles;
  }

  /**
   * Get the default open file from the given tuple files.
   *
   * @param files tuple or explorer files
   * @returns the default open file path
   */
  private static _getDefaultOpenFile(files: TupleFiles | ExplorerFiles) {
    if (!Array.isArray(files)) files = this._convertToTupleFiles(files);

    let defaultOpenFile: string | undefined;
    const libRsFile = files.find(([path]) => path.endsWith("lib.rs"));
    if (libRsFile) {
      defaultOpenFile = libRsFile[0];
    } else if (files.length) {
      defaultOpenFile = files[0][0];
    }

    return defaultOpenFile;
  }
}
