import { useEffect, useState } from "react";

import { PgSession } from "@/features/auth";
import { onDidChangeSyncMarkers, syncMarkerOf } from "@/features/persistence";
import type { SyncMarker } from "@/features/persistence";
import { createLogger } from "@/shared/lib/logger";
import { PgExplorer } from "@/utils";

const log = createLogger("app-nav:sync-markers");

/**
 * By workspace name. A `Map`, not an object: a workspace may be called
 * `constructor` or `__proto__`, which an object would answer from its prototype
 */
type Markers = ReadonlyMap<string, SyncMarker>;

const NONE: Markers = new Map();

const sameMarkers = (a: Markers, b: Markers) =>
  a.size === b.size && [...a].every(([name, marker]) => b.get(name) === marker);

/**
 * Each workspace's sync marker, by name, read again whenever one may have
 * moved: sync's own events (`onDidChangeSyncMarkers`), the session, and the
 * explorer's list. One read at a time: a change during a read queues one
 * more, never a second read alongside it.
 */
export const useSyncMarkers = (): Markers => {
  const [markers, setMarkers] = useState<Markers>(NONE);

  useEffect(() => {
    let disposed = false;
    let running = false;
    let queued = false;
    // What the rows show now, so a read that fails keeps a row's marker
    let shown: Markers = NONE;

    /** Every row's marker; a row whose read failed keeps the one it had */
    const readAll = async () => {
      const next = new Map<string, SyncMarker>();
      const failed: string[] = [];
      for (const name of PgExplorer.allWorkspaceNames ?? []) {
        const id = PgExplorer.workspaceIdOf(name);
        if (!id) continue;
        try {
          const marker = await syncMarkerOf(id, name);
          if (marker) next.set(name, marker);
        } catch (e) {
          // "No marker" would tell the person the account holds this one
          failed.push(String(e));
          const kept = shown.get(name);
          if (kept) next.set(name, kept);
        }
      }
      // Once per pass, not per row: a fault in the store fails every row
      if (failed.length) {
        log.warn("sync markers could not be read", {
          context: { count: failed.length, first: failed[0] },
        });
      }
      return next;
    };

    const read = async () => {
      if (running) {
        queued = true;
        return;
      }
      running = true;
      try {
        do {
          queued = false;
          const next = await readAll();
          if (disposed) return;
          if (!sameMarkers(shown, next)) {
            shown = next;
            setMarkers(next);
          }
        } while (queued);
      } catch (e) {
        // The explorer's list itself could not be read: the rows keep the
        // markers they had, and the next change reads again
        log.warn("sync markers could not be read", { context: { e } });
      } finally {
        running = false;
      }
    };
    const reread = () => void read();

    reread();
    const subscriptions = [
      onDidChangeSyncMarkers(reread),
      PgSession.onDidChange(reread),
      PgExplorer.onDidCreateWorkspace(reread),
      PgExplorer.onDidRenameWorkspace(reread),
      PgExplorer.onDidDeleteWorkspace(reread),
      PgExplorer.onDidSwitchWorkspace(reread),
      PgExplorer.onDidChangeWorkspaceList(reread),
    ];
    return () => {
      disposed = true;
      subscriptions.forEach((s) => s.dispose());
    };
  }, []);

  return markers;
};
