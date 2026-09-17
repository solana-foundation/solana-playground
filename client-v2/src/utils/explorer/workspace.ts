import { tutorialProjectId } from "../../features/persistence/model/project-id";
import { uuid } from "../../features/persistence/model/ids";
import { PgCommon } from "../common";

/** One workspace, as recorded in the workspaces config */
export interface WorkspaceEntry {
  /**
   * Stable across renames. `tut:<slug>` for a tutorial, a uuid otherwise.
   *
   * The name used to be the only handle on a workspace, so a rename silently
   * orphaned anything keyed by it -- `flow.deploys` still has that bug. This
   * is what sync, and eventually those, key on instead.
   */
  id: string;
  name: string;
}

interface Workspaces {
  workspaces: WorkspaceEntry[];
  /** Id of the current workspace */
  currentId?: string;
}

/** The pre-id shape, still on disk for every existing user */
interface LegacyWorkspaces {
  allNames?: string[];
  currentName?: string;
}

/**
 * Workspace functionality class that only exists in the memory state
 *
 * This class does not have access to IndexedDB
 */
export class PgWorkspace {
  /** Class methods */
  private _state: Workspaces;

  /** Workspace errors */
  static errors = {
    ALREADY_EXISTS: "Already exists",
    INVALID_NAME: "Invalid name",
    NOT_FOUND: "Workspace not found",
    CURRENT_NOT_FOUND: "Current workspace not found",
  };

  constructor(workspaces: Workspaces = PgWorkspace.DEFAULT) {
    this._state = workspaces;
  }

  /** Get all workspace names */
  get allNames() {
    return this._state.workspaces.map((w) => w.name);
  }

  /** Get current workspace name */
  get currentName() {
    return this._state.workspaces.find((w) => w.id === this._state.currentId)
      ?.name;
  }

  /** Stable id of the current workspace */
  get currentId() {
    return this._state.currentId;
  }

  /**
   * Get the stable id of a workspace.
   *
   * @param name workspace name
   * @returns its id, or `undefined` when no such workspace exists
   */
  idOf(name: string) {
    return this._state.workspaces.find((w) => w.name === name)?.id;
  }

  /**
   * Get the name a workspace goes by here.
   *
   * The reverse of `idOf`, and the question sync asks: the server knows the
   * id, and this device may well call the project something else.
   *
   * @param id workspace id
   * @returns its local name, or `undefined` when this browser has no such
   * workspace
   */
  nameOf(id: string) {
    return this._state.workspaces.find((w) => w.id === id)?.name;
  }

  /**
   * Get the current workspaces.
   *
   * @returns the current workspaces state
   */
  get(): Workspaces {
    return {
      currentId: this.currentId,
      workspaces: this._state.workspaces,
    };
  }

  /**
   * Set the current workspaces.
   *
   * @param workspaces new workspaces config to set the state to
   */
  setCurrent(workspaces: Workspaces) {
    this._state.workspaces = workspaces.workspaces;
    this._state.currentId = workspaces.currentId;
  }

  /**
   * Set the current workspace name.
   *
   * @param name new workspace name to set the current name to
   */
  setCurrentName(name: string) {
    const entry = this._state.workspaces.find((w) => w.name === name);
    if (entry) this._state.currentId = entry.id;
  }

  /**
   * Create a new workspace in state and set the current state.
   *
   * @param name workspace name
   * @param id existing id to adopt, for a workspace restored from the server.
   * A minted id would be new on every device, so the same project would never
   * converge -- the id has to travel with the project, not be re-derived.
   */
  create(name: string, id?: string) {
    if (this.allNames.includes(name)) {
      throw new Error(PgWorkspace.errors.ALREADY_EXISTS);
    }

    const entry = { id: id ?? PgWorkspace.mintId(name), name };
    this._state.workspaces.push(entry);
    this._state.currentId = entry.id;
  }

  /**
   * Add a workspace in state **without** making it current.
   *
   * `create` switches to what it makes, which is right when the user asked for
   * a new project and wrong when a workspace arrives from somewhere else: a
   * switch navigates the tutorial route away and closes the open conversation,
   * so a background import must not cause one.
   *
   * @param name workspace name
   * @param id the id to adopt, which for an imported workspace is the one the
   * other device already uses
   */
  add(name: string, id: string) {
    if (this.allNames.includes(name)) {
      throw new Error(PgWorkspace.errors.ALREADY_EXISTS);
    }

    this._state.workspaces.push({ id, name });
  }

  /**
   * Delete the given workspace in state.
   *
   * @param name workspace name
   */
  delete(name: string) {
    this._state.workspaces = this._state.workspaces.filter(
      (w) => w.name !== name
    );
    // The deleted one may have been current; leaving the pointer would name a
    // workspace that is no longer there
    if (!this.currentName) this._state.currentId = undefined;
  }

  /**
   * Rename the current workspace.
   *
   * The id does not change -- that is the point of having one. Anything keyed
   * by it, sync included, follows the workspace through the rename.
   *
   * @param newName new workspace name
   */
  rename(newName: string) {
    if (this.allNames.includes(newName)) {
      throw new Error(PgWorkspace.errors.ALREADY_EXISTS);
    }

    const current = this._state.workspaces.find(
      (w) => w.id === this._state.currentId
    );
    if (current) current.name = newName;
  }

  /* ---------------------------- Static methods ---------------------------- */

  /** Default workspaces */
  static readonly DEFAULT: Workspaces = { workspaces: [] };

  /**
   * Mint the id for a new workspace.
   *
   * A tutorial's id is derived from its name so two devices agree on it with
   * no coordination -- the same tutorial is one thread everywhere. Everything
   * else gets a uuid, because two personal projects that happen to share a
   * name are not the same project.
   */
  static mintId(name: string) {
    return PgWorkspace._isTutorialName(name) ? tutorialProjectId(name) : uuid();
  }

  /**
   * Bring the on-disk config forward to the id-carrying shape.
   *
   * Every existing user has the legacy shape, so this runs on every read and
   * is the only place that knows the old field names. Idempotent: an
   * already-migrated config is returned untouched.
   *
   * @param state whatever was parsed out of the config file
   * @returns the migrated state
   */
  static migrate(state: Workspaces | LegacyWorkspaces): Workspaces {
    if ("workspaces" in state && Array.isArray(state.workspaces)) return state;

    const legacy = state as LegacyWorkspaces;
    const workspaces = (legacy.allNames ?? []).map((name) => ({
      id: PgWorkspace.mintId(name),
      name,
    }));

    return {
      workspaces,
      currentId: workspaces.find((w) => w.name === legacy.currentName)?.id,
    };
  }

  /**
   * Teach the class which names are tutorials.
   *
   * Injected rather than imported: `PgTutorial` reaches back into the explorer,
   * and importing it here would close a cycle the build fails on.
   */
  static setIsTutorialName(predicate: (name: string) => boolean) {
    PgWorkspace._isTutorialName = predicate;
  }

  private static _isTutorialName: (name: string) => boolean = () => false;

  /** Path to the file that has data about all the workspaces */
  static readonly WORKSPACES_CONFIG_PATH = "/.config/workspaces.json";

  /* ----------------------- Workspace relative paths ----------------------- */

  /** Relative PATH to workspace data */
  static readonly WORKSPACE_PATH = ".workspace";

  /** Relative path to file metadatas */
  static readonly METADATA_PATH = PgCommon.joinPaths(
    this.WORKSPACE_PATH,
    "metadata.json"
  );

  /** Default name to name the projects that used to be in localStorage */
  static readonly DEFAULT_WORKSPACE_NAME = "default";
}
