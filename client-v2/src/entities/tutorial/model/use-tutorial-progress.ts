import { useCallback, useEffect, useState } from "react";

import { isMissing } from "@/shared/lib/is-missing";
import { createLogger } from "@/shared/lib/logger";

// By module, not the utils barrel, which reads the build's globals on import
import { PgExplorer } from "../../../utils/explorer/explorer";
import { PgTutorial } from "../../../utils/tutorial/tutorial";
import type { TutorialMetadata } from "../../../utils/tutorial/types";
import type { TutorialProgress } from "./progress";
import { conversationProgressOf, progressOf } from "./progress";

const log = createLogger("tutorial:progress");

const NEW: TutorialProgress = { state: "new" };

/**
 * Every registered tutorial's progress, by name, read on mount and again
 * whenever the explorer initialises or its workspace list changes (a start, a
 * delete, a sync import), and whenever the open lesson turns a page or is
 * finished. The open lesson's progress is taken from memory: its file is
 * written after the change is announced, so a read then would lag a page.
 * Before the explorer knows its workspaces every tutorial reads as new. A
 * started tutorial whose saved progress cannot be read shows as started on page
 * 1: a missing file is logged as a warning, any other failure is reported, and
 * none is thrown into the render. A tutorial with a definition counts the steps
 * its conversation passed, and is new until its Start is pressed, workspace or
 * not; it falls back to its page only when its storage cannot be read.
 */
export const useTutorialProgress = (): ((name: string) => TutorialProgress) => {
  const [progress, setProgress] = useState<Map<string, TutorialProgress>>(
    () => new Map()
  );

  useEffect(() => {
    let live = true;
    // Only the latest read lands: one begun on mount can finish after the
    // one the explorer's init begins
    let latest = 0;
    const update = () => {
      const n = ++latest;
      read()
        .then((next) => {
          if (live && n === latest) setProgress(next);
        })
        // The cards keep what they showed
        .catch((e: unknown) => log.error(e, { report: true }));
    };
    // A start creates the workspace; sync imports one without a switch;
    // another tab's list arrives as a list change
    const subs = [
      PgExplorer.onDidInit(update),
      PgExplorer.onDidCreateWorkspace(update),
      PgExplorer.onDidDeleteWorkspace(update),
      PgExplorer.onDidChangeWorkspaceList(update),
      PgTutorial.onDidChangePageNumber(update),
      PgTutorial.onDidChangeCompleted(update),
    ];
    update();
    return () => {
      live = false;
      subs.forEach((sub) => sub.dispose());
    };
  }, []);

  return useCallback((name) => progress.get(name) ?? NEW, [progress]);
};

/**
 * The open lesson's page and completion as held in memory, once both are
 * set. Memory holds the open workspace's lesson, so a route that has moved
 * on to another lesson before the explorer switched reads its file instead,
 * the guard `PgTutorial`'s own storage keeps
 */
const liveMetadata = (name: string): TutorialMetadata | undefined => {
  if (PgTutorial.current?.name !== name) return undefined;
  if (PgExplorer.currentWorkspaceName !== name) return undefined;
  const { pageNumber, completed } = PgTutorial;
  if (pageNumber === null || completed === null) return undefined;
  return { pageNumber, completed };
};

const read = async (): Promise<Map<string, TutorialProgress>> => {
  // Before the explorer is initialised nothing is started yet. The stored
  // names, not `allWorkspaceNames`: the project list shows started lessons
  // with their progress beside a repository, gist or docs link too
  const names = PgExplorer.storedWorkspaceNames;
  if (!names) return new Map();

  const entries = await Promise.all(
    PgTutorial.all.map(async (t) => {
      if (!names.includes(t.name)) return [t.name, NEW] as const;
      if (t.definition) {
        const steps = t.definition.steps.map((s) => s.id);
        const conversation = await readConversation(t.name);
        if (conversation !== READ_FAILED) {
          // Opened, never started: opening creates the workspace before Start
          if (conversation === undefined) return [t.name, NEW] as const;
          const progress = conversationProgressOf(conversation, steps);
          if (progress) return [t.name, progress] as const;
          log.warn(`saved conversation of ${t.name} is unreadable`, {
            context: { tutorial: t.name },
          });
        }
      }
      const live = liveMetadata(t.name);
      if (live) return [t.name, progressOf(true, live, t.pageCount)] as const;
      let meta: TutorialMetadata | undefined;
      try {
        meta = await PgTutorial.getMetadata(t.name);
      } catch (e) {
        if (isMissing(e)) {
          log.warn(`no saved progress for ${t.name}`);
        } else {
          log.error(e, { report: true, context: { tutorial: t.name } });
        }
      }
      return [t.name, progressOf(true, meta, t.pageCount)] as const;
    })
  );
  return new Map(entries);
};

/** The storage file was there and could not be read, already reported */
const READ_FAILED = Symbol("read failed");

/**
 * What a conversation tutorial saved under `conversation`, or undefined when
 * it saved none (a missing file included, silently). Any other failure is
 * reported and reads as `READ_FAILED`, and the card falls back to the page.
 */
const readConversation = async (
  name: string
): Promise<unknown | typeof READ_FAILED> => {
  try {
    return (await PgTutorial.getStorageData(name)).conversation;
  } catch (e) {
    if (isMissing(e)) return undefined;
    log.error(e, { report: true, context: { tutorial: name } });
    return READ_FAILED;
  }
};
