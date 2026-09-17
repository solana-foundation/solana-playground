import { report } from "./diagnostics";
import { buildSnapshot, hashSnapshot } from "./snapshot";
import { PgSyncClient } from "./sync-client";
import { PgSession } from "../../auth";
// Deep import for the same reason `snapshot.ts` uses one: the `utils` barrel
// reaches `settings.ts`, which reads a webpack-defined global jest has no
// answer for, and importing it here would make this module untestable
import { PgExplorer } from "../../../utils/explorer/explorer";
import type { Snapshot } from "./snapshot";
import type { Disposable } from "../../../utils/types";

type PushResult = "ok" | "conflict" | "skipped";

/** A project as `/api/projects` lists it */
export interface ServerProject {
  id: string;
  name: string;
  kind: "project" | "tutorial";
  updatedAt: string;
}

/**
 * Mirror project snapshots to Postgres.
 *
 * Last write wins, but only among writers that had seen the current state: a
 * client whose `baseUpdatedAt` is stale is refused and raises a conflict.
 * Nothing is ever merged -- two divergent copies of a program are not
 * something an automatic merge can reconcile, and a bad merge is worse than a
 * prompt.
 */
export class PgProjectSync {
  /**
   * Upload the workspace the user is looking at.
   *
   * The counterpart to `restoreMissingProjects`: that brings other devices'
   * projects down, and without this there was nothing to bring. `push` had one
   * caller, driven entirely by file-change events, so a project that was not
   * edited after signing in never reached the server at all -- which is most
   * of them, and always the one you just signed in to look at.
   */
  static async pushCurrent(): Promise<PushResult> {
    const id = PgExplorer.currentWorkspaceId;
    if (!id) return "skipped";

    return await PgProjectSync.push(
      id,
      await buildSnapshot(),
      PgExplorer.currentWorkspaceName
    );
  }

  /**
   * @param name what to call the project on the server. The local name is
   * authoritative: it is what the user typed, and what they renamed. Without
   * it this fell back to the id, so every project that originated here was
   * stored under its own id -- and a tutorial imported elsewhere as
   * `tut:hello-anchor` is a name `PgTutorial` does not match, so the tutorial
   * read as unstarted on the second device.
   */
  static async push(
    projectId: string,
    snapshot: Snapshot,
    name?: string
  ): Promise<PushResult> {
    if (!(await PgProjectSync._ready())) return "skipped";
    // Nothing goes up before this browser has read what the account holds.
    // A push that arrives first carries no token, which the server can only
    // treat as a blind create and refuse -- a "conflict" caused by load order
    // rather than by anything the user did.
    await PgProjectSync._gate;

    const hash = hashSnapshot(snapshot);
    if (PgProjectSync._hashes.get(projectId) === hash) return "skipped";

    try {
      const response = await fetch("/api/projects", {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: projectId,
          name: name ?? PgProjectSync._names.get(projectId) ?? projectId,
          kind: projectId.startsWith("tut:") ? "tutorial" : "project",
          snapshot,
          baseUpdatedAt: PgProjectSync._base.get(projectId),
        }),
      });

      if (response.status === 409) {
        // Deliberately without recording the hash: the snapshot has not been
        // accepted, and remembering it would make every later attempt look
        // unchanged and strand the project out of sync for good.
        //
        // Only a device that had actually read the row is told about it. A
        // refusal with no token of our own means this browser had not caught
        // up yet -- the reconcile on load is what fixes that, and saying "your
        // other device changed this" offers a Reload that does nothing, since
        // the next load would land in exactly the same place. A conflict the
        // user can act on is two sessions editing one project, and that one
        // always has a token behind it.
        if (PgProjectSync._base.has(projectId)) {
          for (const cb of PgProjectSync._conflictListeners) cb(projectId);
        }
        return "conflict";
      }
      if (!response.ok) {
        report(`push project ${projectId}: HTTP ${response.status}`, null);
        return "skipped";
      }

      const body = await response.json();
      PgProjectSync._base.set(projectId, body.updatedAt);
      PgProjectSync._hashes.set(projectId, hash);
      return "ok";
    } catch (e) {
      report(`push project ${projectId}`, e);
      return "skipped";
    }
  }

  /**
   * What the server holds for this user.
   *
   * @returns the project list, or empty when sync is unavailable -- which is
   * indistinguishable from "no projects" on purpose, so callers have one path
   */
  static async list(): Promise<ServerProject[]> {
    if (!(await PgProjectSync._ready())) return [];

    try {
      const response = await fetch("/api/projects", {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) {
        report(`list projects: HTTP ${response.status}`, null);
        return [];
      }
      const body = await response.json();
      return Array.isArray(body?.projects) ? body.projects : [];
    } catch (e) {
      report("list projects", e);
      return [];
    }
  }

  /**
   * Read one project, snapshot included.
   *
   * Records the server's token as a side effect, so the next push for this
   * project is a compare-and-swap against what was actually read rather than
   * an unconditional write.
   */
  static async fetch(
    projectId: string
  ): Promise<(ServerProject & { snapshot: Snapshot | null }) | null> {
    if (!(await PgProjectSync._ready())) return null;

    try {
      const response = await fetch(
        `/api/projects?id=${encodeURIComponent(projectId)}`,
        { credentials: "include", cache: "no-store" }
      );
      if (!response.ok) {
        report(`fetch project ${projectId}: HTTP ${response.status}`, null);
        return null;
      }

      const { project } = await response.json();
      if (!project) return null;

      PgProjectSync.seen(project.id, project.name, project.updatedAt);
      // This device now holds exactly what the server does, so there is
      // nothing to send back. Without this, taking the server's copy was
      // immediately followed by pushing it up again -- a write that bumps the
      // row and, on the other device, is indistinguishable from an edit.
      if (project.snapshot) {
        PgProjectSync._hashes.set(project.id, hashSnapshot(project.snapshot));
      }
      return project;
    } catch (e) {
      report(`fetch project ${projectId}`, e);
      return null;
    }
  }

  /** Record the server's state for a project we just read */
  static seen(projectId: string, name: string, updatedAt: string) {
    PgProjectSync._names.set(projectId, name);
    PgProjectSync._base.set(projectId, updatedAt);
  }

  static onDidConflict(cb: (projectId: string) => void): Disposable {
    PgProjectSync._conflictListeners.add(cb);
    return { dispose: () => PgProjectSync._conflictListeners.delete(cb) };
  }

  /**
   * Hold every push until `releasePushes`.
   *
   * Called once on load, before anything can fire. The alternative is a race:
   * the editor's own debounce is a few seconds, the reconcile is several
   * round trips, and whichever wins decides whether the user is accused of a
   * conflict. Holding makes the answer the same every time.
   *
   * Open by default, so a caller that never reconciles -- a test, or any
   * entry point that does not run the session effect -- is not left waiting
   * on something that will never happen.
   */
  static holdPushes() {
    if (PgProjectSync._release) return;
    PgProjectSync._gate = new Promise((resolve) => {
      PgProjectSync._release = resolve;
    });
  }

  /** Let held pushes through. Safe to call more than once. */
  static releasePushes() {
    PgProjectSync._release?.();
    PgProjectSync._release = null;
    PgProjectSync._gate = Promise.resolve();
  }

  /** Test seam */
  static reset() {
    PgProjectSync._base.clear();
    PgProjectSync._hashes.clear();
    PgProjectSync._names.clear();
    PgProjectSync._conflictListeners.clear();
    PgProjectSync.releasePushes();
  }

  private static _gate: Promise<void> = Promise.resolve();
  private static _release: (() => void) | null = null;

  private static readonly _base = new Map<string, string>();
  private static readonly _hashes = new Map<string, string>();
  private static readonly _names = new Map<string, string>();
  private static readonly _conflictListeners = new Set<
    (projectId: string) => void
  >();

  private static async _ready() {
    return !!PgSession.get() && (await PgSyncClient.available());
  }
}
