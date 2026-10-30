import { report } from "./diagnostics";
import {
  freeName,
  isCleanAgainst,
  isUsableSnapshot,
  PgProjectSync,
} from "./project-sync";
import { diffFiles, hashFiles, snapshotOf } from "./snapshot";
import { PgSyncBase } from "./sync-base";
import { withSyncLock } from "./sync-lock";
import { PgSyncMark } from "./sync-mark";
import { reloadCurrentFromDisk } from "./tab-reload";
import { PgThreadIndex } from "./thread-index";
import { PgWorkspaceRegistry } from "./workspace-registry";
import { PgExplorer } from "../../../utils/explorer/explorer";
import type { Conflict, ServerProject } from "./project-sync";
import type { SyncMark } from "./sync-mark";

/** What one reconcile pass did */
export interface SyncResult {
  /** Local names of projects created here for the first time */
  imported: string[];
  /** Local names of projects whose files were taken from the server */
  replaced: string[];
  /** Local names of projects deleted here because they were deleted elsewhere */
  removed: string[];
  /** Local names of projects this device uploaded */
  pushed: string[];
  /** Projects the user now has to answer for */
  conflicts: Conflict[];
  /**
   * Local name of the most recently updated project the server holds, or
   * `null` when it holds none. What to open when the user has just signed in
   * and is looking at nothing in particular.
   */
  latest: string | null;
}

const empty = (): SyncResult => ({
  imported: [],
  replaced: [],
  removed: [],
  pushed: [],
  conflicts: [],
  latest: null,
});

/**
 * Whether the local copy is exactly what this device last handed the server.
 *
 * Decided on the hash alone. `dirty` is only ever a hint -- it says "do not
 * trust the cheap path, go and look", and it is set liberally because the cost
 * of setting it when nothing changed is one hash, while the cost of missing it
 * is an upload that never happens.
 *
 * Treating it as decisive here was wrong in a way that showed up immediately:
 * a project that had merely been *opened* is flagged, because a workspace
 * switch fires on every load. So nothing was ever clean, the silent "take the
 * server's copy" path was unreachable, and a device that had done nothing at
 * all was asked to choose.
 *
 * Compared on user files only, rather than the whole snapshot. The generated workspace files are rewritten on every open, so a
 * device that has just adopted another's copy differs from it within a second
 * through nothing anyone typed, and on the *next* exchange that read as this
 * device having work of its own.
 */
const isClean = async (projectId: string, localName: string) =>
  await isCleanAgainst(
    await PgSyncMark.read(projectId),
    localName,
    (
      await snapshotOf(localName)
    ).files
  );

/**
 * Give a project back the server's name, where an adopt or a merge left the
 * workspace a stand-in because another local workspace held the name, or
 * because renaming to it failed.
 *
 * Found by the mark, which records the stand-in (`SyncMark.localName`); a
 * rename the user made here is never recorded there, and is not this pass's
 * to undo.
 *
 * Runs after the main pass and the deletes, which are what move a holder
 * out of the way: deleted elsewhere, or renamed -- the other device renamed
 * "Bar" to "Baz" and then "Foo" to "Bar", and reconcile reaches "Foo"
 * first. A name still held here stays stepped around.
 */
const settleSteppedNames = async (server: ServerProject[]) => {
  for (const project of server) {
    const local = PgExplorer.workspaceNameOf(project.id);
    if (!local || local === project.name) continue;
    try {
      await PgProjectSync.settleStandIn(project.id, project.name);
    } catch (e) {
      report(`rename ${local} back to ${project.name}`, e);
    }
  }
};

/**
 * Make this browser and the account agree, without guessing.
 *
 * Runs on sign-in, on load, and whenever a backgrounded tab comes back. Each
 * project lands in one of four cells, decided by two independent questions --
 * has this device changed it since the server last took a copy, and has the
 * server moved since then:
 *
 * |          | server unchanged | server moved |
 * | -------- | ---------------- | ------------ |
 * | clean    | nothing          | take server  |
 * | dirty    | push             | **merge**    |
 *
 * Both questions are answerable only because `PgSyncMark` persists what the
 * server last accepted from *this* device. Without it "local differs from the
 * server" is one undifferentiated state, and the previous version of this
 * function resolved it by always taking the server's copy -- which quietly
 * destroyed anything that had not finished uploading.
 *
 * The bottom-right cell is the only one that can ask the user anything, and
 * only about lines both copies changed: everything else merges, and for those
 * lines nothing here is entitled to pick.
 *
 * Deletes are the same shape. A project the server no longer lists, for which
 * this device holds a mark, was deleted on another device: if the local copy is
 * clean the delete finishes here, and if it is not the user is asked rather
 * than having unsaved work removed on another device's say-so.
 *
 * One pass at a time. Several things ask for one -- the session on load, the
 * explorer's first switch, a tab coming back, an adoption's re-open -- and two
 * passes that overlap each see the other's writes half made: a workspace
 * `importFresh` has created but not yet marked reads as a copy with work of
 * its own, and merging that renamed the account's row to its de-duplicated
 * local name. So a caller that arrives mid-pass waits for it, and then gets a
 * pass of its own, shared with every other caller that arrived meanwhile.
 *
 * Not the pass already running: that one may have started signed out, or
 * before the import the caller is asking about, and its `latest` and
 * `replaced` would then answer a question nobody asked. Nothing inside a pass
 * awaits `reconcile`, so waiting here cannot wait on itself -- the switch an
 * adoption's re-open dispatches starts one without awaiting it.
 */
export const reconcile = (): Promise<SyncResult> => {
  if (!running) return start();
  queued ??= new Promise<SyncResult>((resolve, reject) => {
    next = { resolve, reject };
  });
  return queued;
};

/** The pass in progress, if any */
let running: Promise<SyncResult> | null = null;
/** The one pass every caller that arrived during `running` will share */
let queued: Promise<SyncResult> | null = null;
let next: {
  resolve: (result: SyncResult) => void;
  reject: (error: unknown) => void;
} | null = null;

const start = (): Promise<SyncResult> => {
  const current = pass();
  running = current;
  const settle = () => {
    running = null;
    // Handed over in the same turn that `running` clears, so a caller that
    // arrives in between cannot start a pass alongside the queued one
    if (!next) return;
    const { resolve, reject } = next;
    next = null;
    queued = null;
    start().then(resolve, reject);
  };
  current.then(settle, settle);
  return current;
};

/**
 * One pass, held under `withSyncLock`: it decides against the sync marks,
 * which every tab of this browser shares, and a push or a merge in another
 * tab must not change a mark between this pass reading it and acting on it.
 * The coalescing above orders passes within this tab; the lock orders them
 * against the other tabs.
 */
const pass = (): Promise<SyncResult> => withSyncLock(passUnlocked);

const passUnlocked = async (): Promise<SyncResult> => {
  const result = empty();

  // First, bring the open workspace in line with the store. Another tab may
  // have written it since this one last looked, and everything below reads
  // the store while the editor still shows memory -- so a pass that adopted
  // or merged over a stale editor left it to autosave the old text back.
  //
  // Before the availability check, deliberately: the overwrite between tabs
  // needs no account, and this is how a tab catches up on focus when it
  // missed `effects/tab-sync`'s broadcast or the browser has none.
  try {
    await reloadCurrentFromDisk();
  } catch (e) {
    report("reload before reconcile", e);
  }

  // Before anything builds a snapshot. Signed out, or on a deployment with no
  // database, every call below is already a no-op -- but `push` takes a
  // snapshot as an argument, so reaching it means having built one, and that
  // is a walk of the whole workspace. This runs on every project switch now,
  // so paying it for a browser that is not syncing at all is not cheap.
  if (!(await PgProjectSync.isAvailable())) return result;

  const server = await PgProjectSync.list();
  // Not knowing what the account holds is not the same as it holding nothing.
  // Everything below decides on absence, so without the list there is nothing
  // it can safely decide; the next reconcile will have one.
  if (!server) return result;
  const serverIds = new Set(server.map((project) => project.id));

  // Newest first. The server orders its answer this way already; sorting here
  // means `latest` does not quietly depend on that staying true.
  const newestFirst = [...server].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  );

  for (const project of newestFirst) {
    PgProjectSync.rememberName(project.id, project.name);
    const local = PgExplorer.workspaceNameOf(project.id);

    // A merge of it is already reading the server and rewriting the
    // workspace, and racing it for the mark could undo it. Left for the next
    // pass -- the merge uploads what it settles on itself.
    if (PgProjectSync.isMerging(project.id)) {
      if (local) result.latest ??= local;
      continue;
    }

    try {
      if (!local) {
        const name = await importFresh(project.id, project.name);
        if (name) {
          result.imported.push(name);
          result.latest ??= name;
        }
        continue;
      }

      result.latest ??= local;

      const mark =
        (await PgSyncMark.read(project.id)) ??
        (await rebaseWholeSnapshotMark(project, local));
      // Left for the next pass, which can read the row
      if (mark === "retry") continue;

      // The cheap path, and the overwhelmingly common one: this device has
      // nothing pending and the row is exactly where it was left. Neither side
      // moved, so there is nothing to compare and no files to read.
      if (mark && !mark.dirty && mark.updatedAt === project.updatedAt) continue;

      const clean = await isClean(project.id, local);
      const serverMoved = !mark || mark.updatedAt !== project.updatedAt;

      if (clean && serverMoved) {
        // Safe by construction: the local copy is byte-for-byte what this
        // device uploaded, so there is nothing here to lose.
        const adopted = await PgProjectSync.adopt(project.id);
        if (adopted) result.replaced.push(adopted);
        continue;
      }

      if (!serverMoved && !clean) {
        // This device is ahead and nothing else has written since. Ordinary
        // catch-up: an edit that was still debounced when the tab closed, a
        // push that failed while offline, or a rename -- which `isClean`
        // catches because the mark records the name as well as the hash.
        // With the generation read first, so a merge the banner starts while
        // this reads the files stops this snapshot from going up after it
        const generation = PgProjectSync.generationOf(project.id);
        if (
          (await PgProjectSync.push(
            project.id,
            await snapshotOf(local),
            local,
            { immediate: true, generation }
          )) === "ok"
        ) {
          result.pushed.push(local);
        }
        continue;
      }

      if (serverMoved && !clean) {
        const settled = await settleDivergence(project.id, local, result);
        if (settled) result.conflicts.push(settled);
      }
    } catch (e) {
      // One project that cannot be reconciled must not strand the rest -- but
      // it must not vanish silently either, or it is simply missing with
      // nothing to explain it
      report(`reconcile project ${project.id}`, e);
    }
  }

  // Deletes first: a holder deleted on the other device frees its name for
  // a stand-in in the same pass
  await settleDeletes(serverIds, result);
  await settleSteppedNames(server);
  await pushNeverSynced(serverIds, result);

  return result;
};

/**
 * Turn a whole-snapshot mark into a per-file one, where the row
 * has not moved since.
 *
 * That mark holds no hash per file, so `read` returns `null` for it and the
 * project would merge against an empty base: every file this device edited
 * since asked as "both devices changed this", and every file it deleted
 * brought back from the server, because with no base a file missing here
 * reads as unchanged here, so the server's copy wins. But a row still at the mark's timestamp holds exactly
 * what this device last agreed on, so its files are the base the mark lacks.
 * Hashed into a per-file mark, the project goes down reconcile's
 * ordinary path: a device that is ahead pushes the difference.
 *
 * The files this device changed keep their agreed content as a base, as a
 * push would have kept them, so a write that overtakes the upload still
 * merges by line.
 *
 * Where the row has moved, nothing here can say what was agreed, and the old
 * mark is left to the merge against an empty base. Where the row could not
 * be read, the project waits for the next pass: falling through to that
 * merge on a dropped request is the very loss this exists to prevent.
 *
 * @returns the new mark; `null` when there is no whole-snapshot mark, the row
 * has moved past it, or it holds no usable files to rebase on; `"retry"`
 * when the row could not be read
 */
const rebaseWholeSnapshotMark = async (
  project: ServerProject,
  local: string
): Promise<SyncMark | "retry" | null> => {
  const old = await PgSyncMark.readWholeSnapshotMark(project.id);
  if (!old || old.updatedAt !== project.updatedAt) return null;

  const full = await PgProjectSync.fetch(project.id);
  if (!full) {
    report(`rebase whole-snapshot mark ${project.id}: row unreadable`, null);
    return "retry";
  }
  // Re-checked on the copy actually read: the row may move after the list
  if (full.updatedAt !== old.updatedAt) return null;
  if (!isUsableSnapshot(full.snapshot)) {
    // No files to agree on: reconcile pushes this copy over the row, as it
    // does for any row that holds no code
    if (full.snapshot) {
      report(
        `rebase whole-snapshot mark ${project.id}: unusable snapshot`,
        null
      );
    }
    return null;
  }

  const agreed = await hashFiles(full.snapshot);
  const here = (await snapshotOf(local)).files;
  // Flagged whatever the copy holds now: `markDirty` does nothing while the
  // old mark is on disk, so an edit saved after `here` was read has nothing
  // else to say it is owed. The pass re-hashes it below either way.
  const mark: SyncMark = {
    files: agreed,
    name: full.name,
    updatedAt: full.updatedAt,
    dirty: true,
  };

  const { changed } = diffFiles(agreed, await hashFiles({ files: here }));
  await PgSyncBase.capture(project.id, changed, agreed, full.snapshot.files);
  await PgSyncMark.write(project.id, mark);
  return mark;
};

/**
 * Decide whether "both sides differ" is really a question for the user.
 *
 * Mostly it is not, and the merge settles it: two copies that are identical
 * -- a tutorial, whose id is derived from its name and so is minted
 * independently on every browser, holds the same bytes as the server with
 * only the token missing -- merge to themselves, and so do edits to different
 * files or to lines that do not overlap. What the merge cannot settle is
 * raised with the files it concerns.
 *
 * One case is handled before the merge, because there is nothing to merge
 * with: **the row has no code.** `ensureConversation` creates a `projects` row
 * so a chat turn has a parent, so a project whose assistant was used before
 * its first upload already exists server-side with a null snapshot. There is
 * nothing there to lose, so this device's copy simply goes up.
 *
 * Neither happens to a project another account left on this browser under an
 * id this one also has, which a tutorial's can be. The merge writes this
 * account's mark before its own upload, so the push's check would never see
 * it, and the previous user's files would reach this account.
 *
 * Skipping it leaves a known gap: the account's own copy is never brought
 * down while the leftover holds the id, so the user goes on seeing the other
 * account's files, and their edits to them do not sync. Reaching it takes two
 * GitHub accounts signing in on one browser, so it is reported under its own
 * message (`hiding-account-copy`) rather than handled.
 *
 * @returns the conflict actually raised, or `null` when it settled itself
 */
const settleDivergence = async (
  projectId: string,
  local: string,
  result: SyncResult
): Promise<Conflict | null> => {
  if (await PgSyncMark.belongsToAnotherAccount(projectId)) {
    PgProjectSync.reportDisowned(projectId, "hiding-account-copy");
    return null;
  }

  const full = await PgProjectSync.fetch(projectId);

  if (!full || !isUsableSnapshot(full.snapshot)) {
    if (full?.snapshot)
      report(`reconcile ${projectId}: unusable snapshot`, null);
    if (
      (await PgProjectSync.push(projectId, await snapshotOf(local), local, {
        immediate: true,
      })) === "ok"
    ) {
      result.pushed.push(local);
    }
    return null;
  }

  // Identical copies, a missing mark, one side ahead per file, lines that do
  // not overlap: all of it settles without a question. What is left is raised
  // with the files it concerns.
  const outcome = await PgProjectSync.mergeWithServer(projectId, local);
  if (outcome === "merged") {
    result.replaced.push(local);
    return null;
  }
  return PgProjectSync.conflictFor(projectId);
};

/**
 * Bring down a project this browser has never had.
 *
 * Nothing local is at risk here, so it needs no comparison -- but the snapshot
 * still has to be checked, because `importWorkspace` would otherwise write a
 * workspace whose files are whatever a malformed row happens to hold.
 */
const importFresh = async (
  projectId: string,
  serverName: string
): Promise<string | null> => {
  const full = await PgProjectSync.fetch(projectId);
  if (!isUsableSnapshot(full?.snapshot)) {
    // A null snapshot is an ordinary state, not a fault: a chat turn creates
    // the row before the project's first upload. Nothing to import yet.
    if (full?.snapshot) report(`import ${projectId}: unusable snapshot`, null);
    return null;
  }

  // Off the live list: an adopt or a merge earlier in this pass may have
  // renamed a workspace onto the name, and `importWorkspace` refuses one
  // that is taken
  const name = freeName(serverName);
  await PgExplorer.importWorkspace(name, {
    id: projectId,
    files: full!.snapshot!.files,
  });

  await PgSyncMark.write(projectId, {
    files: await hashFiles(full!.snapshot!),
    name: serverName,
    // Stepped around a local workspace holding the name: a stand-in, which
    // no push sends and `settleSteppedNames` gives back once it is free
    ...(name !== serverName ? { localName: name } : {}),
    updatedAt: full!.updatedAt,
    dirty: false,
  });
  // A tutorial restarted under the same id must not inherit an old base
  await PgSyncBase.clear(projectId);

  return name;
};

/**
 * Finish deletes that happened on another device.
 *
 * A mark with no server row is the only way to tell "deleted elsewhere" from
 * "never uploaded" -- the list endpoint filters tombstones out, so both look
 * like absence without one.
 */
const settleDeletes = async (serverIds: Set<string>, result: SyncResult) => {
  for (const projectId of await PgSyncMark.projectIds()) {
    if (serverIds.has(projectId)) continue;

    try {
      const local = PgExplorer.workspaceNameOf(projectId);
      if (!local) {
        // Gone from both sides. The mark and the thread-index entry are the
        // last things left of it.
        await PgSyncMark.remove(projectId);
        await PgThreadIndex.forget(projectId);
        continue;
      }

      if (await isClean(projectId, local)) {
        await PgExplorer.deleteWorkspace(local);
        await PgSyncMark.remove(projectId);
        // The server tombstoned its conversations with it; this device's
        // copy goes too, or a tutorial started again here opens the old
        // run's chat
        await PgThreadIndex.forget(projectId);
        result.removed.push(local);
        if (result.latest === local) result.latest = null;
        continue;
      }

      const conflict: Conflict = { projectId, kind: "deleted-elsewhere" };
      PgProjectSync.raise(conflict);
      result.conflicts.push(conflict);
    } catch (e) {
      report(`settle delete ${projectId}`, e);
    }
  }
};

/**
 * Hand over projects the account has never seen.
 *
 * Previously this waited for the user to open a project, because the only
 * thing that pushed was the editor's own change handler -- so a project made
 * before signing in, and not touched since, stayed on one device forever. The
 * promise is that everything is saved, not everything that was visited.
 *
 * "Never seen" has to exclude two things that also look unsynced from here: a
 * project deleted on another device, which `settleDeletes` owns, and a project
 * belonging to a different account on this browser. Workspaces are not
 * account-scoped and are not cleared on sign-out, so without the second check
 * the next person to sign in on a shared browser uploads the previous one's
 * work into their own account.
 *
 * It also excludes a workspace only this tab still believes in. A
 * neighbouring tab that deletes a project takes its mark with it, so until
 * this tab has re-read the list the ghost looks exactly like a project never
 * uploaded, and its upload meets the tombstone. The reload at the start of
 * the pass normally catches this first; this is the check for a reconcile
 * that runs before the neighbour's write is announced, asking the store's
 * registry, which is what the other tab changed.
 */
const pushNeverSynced = async (serverIds: Set<string>, result: SyncResult) => {
  for (const name of PgExplorer.allWorkspaceNames ?? []) {
    const id = PgExplorer.workspaceIdOf(name);
    if (!id || serverIds.has(id)) continue;
    // Any mark at all, including one `read` cannot use: it is the record that
    // this device synced the project, which makes its absence from the list a
    // delete elsewhere -- `settleDeletes`'s -- and a create-only upload of it
    // a refusal against the tombstone
    if (await PgSyncMark.exists(id)) continue;
    if (await PgSyncMark.belongsToAnotherAccount(id)) continue;
    if (!(await PgWorkspaceRegistry.has(name, id))) continue;

    try {
      if (
        (await PgProjectSync.push(id, await snapshotOf(name), name, {
          immediate: true,
        })) === "ok"
      ) {
        result.pushed.push(name);
      }
    } catch (e) {
      report(`push new project ${id}`, e);
    }
  }
};

/**
 * Give this browser back, on sign-out.
 *
 * Local workspaces are not account-scoped -- they predate accounts, and
 * signing out never cleared them -- so the next person to sign in here found
 * the previous user's projects sitting in the explorer.
 * `PgSyncMark.belongsToAnotherAccount` already stops those being *uploaded*
 * into the new account -- unless the new account claimed one by creating it
 * here -- so nothing reaches the server that should not; what was left is
 * that they are visible.
 *
 * Decided per project, and only where the account demonstrably holds the same
 * content -- the same trade `PgChatSync.forget` makes for conversations,
 * and it has to be the same one for the same reason. The flush before the
 * sign-out request can fail while the sign-out itself succeeds, so "the server
 * has this" is a question that can genuinely be answered "no", and deleting on
 * the strength of a push that never happened is exactly how work disappears.
 * The cost of being wrong in this direction is that the next user of the
 * browser sees a project that is not theirs; the cost of being wrong the
 * other way is somebody's afternoon.
 *
 * Runs only after the server has ended the session, so it pushes nothing:
 * the open workspace is flushed beforehand, by the session effect, while the
 * request is still authenticated.
 *
 * Every removal runs inside `whileSigningOut`, because each one reaches the
 * `project-sync` effect as an ordinary `onDidDeleteWorkspace` -- the same
 * event a user deleting a project raises, carrying no id and nothing to say
 * who asked. That effect answers it by tombstoning the row and clearing its
 * snapshot, so signing out emptied the account and signing back in found
 * nothing to restore. It is also what stops the switch the explorer dispatches
 * on the way past from starting a reconcile that re-imports the very
 * workspaces being removed.
 *
 * The marks are deliberately left behind rather than cleared alongside. They
 * are keyed per account, so they are not the next user's to read, and they are
 * what makes signing back in free: the server's copy is re-imported by the
 * next reconcile, and a project deleted elsewhere meanwhile is recognised as
 * deleted rather than pushed back up.
 *
 * @returns the local names of the workspaces removed
 */
export const releaseLocalProjects = async (): Promise<string[]> =>
  PgProjectSync.whileSigningOut(async () => {
    // Copied, because `deleteWorkspace` mutates the explorer's own list and
    // iterating it while it shrinks skips every other entry
    const names = [...(PgExplorer.allWorkspaceNames ?? [])];
    const removed: string[] = [];

    for (const name of names) {
      try {
        const id = PgExplorer.workspaceIdOf(name);
        // No id means nothing was ever synced under it, and `isClean` is
        // false for a project with no mark -- either way it is not ours to
        // delete
        if (!id || !(await isClean(id, name))) continue;

        await PgExplorer.deleteWorkspace(name);
        removed.push(name);
      } catch (e) {
        report(`release ${name}`, e);
      }
    }

    return removed;
  });
