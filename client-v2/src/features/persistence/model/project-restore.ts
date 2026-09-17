import { report } from "./diagnostics";
import { PgProjectSync } from "./project-sync";
import { PgExplorer } from "../../../utils/explorer/explorer";
import type { ServerProject } from "./project-sync";

/** What one pass of `syncProjectsFromServer` did */
export interface SyncResult {
  /** Local names of projects created here for the first time */
  imported: string[];
  /** Local names of projects whose files were taken from the server */
  replaced: string[];
  /**
   * Local name of the most recently updated project the server holds, or
   * `null` when it holds none. What to open when the user has just signed in
   * and is looking at nothing in particular.
   */
  latest: string | null;
}

/**
 * Make the server's copy of every project the one this browser holds.
 *
 * The server is authoritative, not merely a backup of last resort. A device
 * that has been away -- or one that has never seen the account at all -- must
 * end up with the account's work, whatever it happened to have locally.
 *
 * That is a deliberate change from bringing down only what is *missing*.
 * Missing-only looks right until two devices share an id, which for tutorials
 * is always: the id is derived from the name, so opening `hello-anchor` on a
 * second browser mints the same `tut:hello-anchor` locally. The real project
 * was then never "missing", and the blank local copy stayed forever, with the
 * push behind it refused as a conflict that reloading could not clear.
 *
 * Genuinely concurrent editing is not this. Two sessions writing to one
 * project is caught where it happens -- on the next push, whose
 * compare-and-swap fails and raises the conflict banner -- and that is the
 * only case where the user is asked anything.
 *
 * Fetching each project records the server's token for it, so every later
 * push from here is a compare-and-swap against something actually read,
 * rather than a blind create that any existing row would refuse.
 *
 * Deliberately additive still: a local project the server has never heard of
 * is left alone, because the push that hands it over has not necessarily run
 * yet. Nothing local is ever deleted here.
 */
export const syncProjectsFromServer = async (): Promise<SyncResult> => {
  const server = await PgProjectSync.list();
  const result: SyncResult = { imported: [], replaced: [], latest: null };
  if (!server.length) return result;

  // Newest first. The server orders its answer this way already; sorting here
  // means `latest` does not quietly depend on that staying true.
  const newestFirst = [...server].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  );

  const taken = new Set(PgExplorer.allWorkspaceNames ?? []);

  for (const project of newestFirst) {
    const full = await PgProjectSync.fetch(project.id);
    if (!full?.snapshot) continue;

    const local = PgExplorer.workspaceNameOf(project.id);

    try {
      if (local) {
        await PgExplorer.replaceWorkspaceFiles(local, full.snapshot.files);
        result.replaced.push(local);
        result.latest ??= local;
      } else {
        let name = project.name;
        while (taken.has(name)) name = `${name} (imported)`;

        await PgExplorer.importWorkspace(name, {
          id: project.id,
          files: full.snapshot.files,
        });
        taken.add(name);
        result.imported.push(name);
        result.latest ??= name;
      }
    } catch (e) {
      // One project that cannot be written must not strand the rest -- but it
      // must not vanish silently either, or it is simply missing with nothing
      // to explain it
      report(`sync project ${project.id}`, e);
    }
  }

  return result;
};
