import { useCallback, useEffect, useRef, useState } from "react";

import { BaseConflictResolver } from "./BaseConflictResolver";
import { conflictKey } from "./merge-editor/merge-file";
import { createLogger } from "../../../shared/lib/logger";
import { PgProjectSync } from "../model/project-sync";
import { persistenceTelemetry } from "../model/telemetry";
import type { FileConflict, ResolvedFiles } from "../model/merge";
import type { Conflict, Resolution } from "../model/project-sync";
import type { HunkSideParam } from "../model/telemetry";
import type { HunkSide } from "./merge-editor/merge-file";

const log = createLogger("persistence:resolve");

/** How many hunks the view asks about: one per whole file, none if settled */
const hunksIn = (files: readonly FileConflict[]) =>
  files.reduce((n, file) => {
    if (file.kind === "lines") {
      return n + file.chunks.filter((c) => c.kind === "conflict").length;
    }
    return n + (file.kind === "whole" ? 1 : 0);
  }, 0);

/** The paths of `next` whose copies differ from those `before` was read from */
const movedSince = (
  before: readonly FileConflict[],
  next: readonly FileConflict[]
) => {
  const keys = new Map(before.map((f) => [f.path, conflictKey(f)]));
  return next
    .filter((f) => keys.get(f.path) !== conflictKey(f))
    .map((f) => f.path);
};

/** The files a conflict asks about line by line, or `null` for none */
const filesOf = (conflict: Conflict | null): FileConflict[] | null =>
  conflict?.kind === "divergent" && conflict.files?.length
    ? conflict.files
    : null;

/** What came of an answer handed to sync */
type AnswerOutcome = "settled" | "standing" | "threw";

/** A hunk's side as the event names it */
const SIDE_PARAM: Record<HunkSide | "none", HunkSideParam> = {
  left: "this-device",
  right: "other-device",
  none: "none",
};

/**
 * The resolve view over a project's divergent conflict.
 *
 * Follows the conflict while open. Raised again with other copies of its
 * files -- the other device saved meanwhile, or an answer was refused
 * because it had -- it shows the new files and names the ones that moved;
 * an answer made against the old ones can only be refused (pinned hashes),
 * so nothing has to be locked while the user decides. Settled, or turned
 * into another kind of question, it closes.
 */
export const ConflictResolver = ({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) => {
  const [files, setFiles] = useState(() =>
    filesOf(PgProjectSync.conflictFor(projectId))
  );
  const shown = useRef(files);
  const [changed, setChanged] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // An answer clears the question before uploading and may raise it again,
  // so while one is out a missing conflict is not yet a reason to close
  const answering = useRef(false);

  // Once per open, with what it opened on. A ref, because StrictMode runs
  // the effect twice on mount and keeps the ref between the two runs.
  const opened = useRef(false);
  useEffect(() => {
    if (!shown.current || opened.current) return;
    opened.current = true;
    persistenceTelemetry.track("sync_resolve_opened", {
      files: shown.current.length,
      hunks: hunksIn(shown.current),
    });
  }, []);

  const follow = useCallback(() => {
    const next = filesOf(PgProjectSync.conflictFor(projectId));
    if (!next) {
      if (!answering.current) onClose();
      return;
    }
    const before = shown.current ?? [];
    const moved = movedSince(before, next);
    if (!moved.length && next.length === before.length) return;
    shown.current = next;
    setFiles(next);
    setChanged(moved);
  }, [projectId, onClose]);

  useEffect(() => {
    const subscription = PgProjectSync.onDidChangeConflicts(follow);
    return () => subscription.dispose();
  }, [follow]);

  /**
   * Hand an answer to sync.
   *
   * @returns `settled`, or why not: `standing` when sync left the question
   * up (refused, or failed and said so), `threw` when it threw, which is
   * logged here. The question stands in both.
   */
  const answer = async (resolution: Resolution): Promise<AnswerOutcome> => {
    answering.current = true;
    setBusy(true);
    let outcome: AnswerOutcome = "standing";
    try {
      if (await PgProjectSync.resolve(projectId, resolution)) {
        outcome = "settled";
      }
    } catch (e) {
      log.error(e, {
        report: true,
        context: {
          resolution:
            typeof resolution === "string" ? resolution : resolution.kind,
        },
      });
      outcome = "threw";
    } finally {
      answering.current = false;
      setBusy(false);
    }
    // Refused or failed: the question stands, perhaps about new copies
    if (outcome === "settled") onClose();
    else follow();
    return outcome;
  };

  const apply = async (resolved: ResolvedFiles) => {
    const answered = files ?? [];
    const outcome = await answer({ kind: "resolved", files: resolved });
    if (outcome === "settled") {
      persistenceTelemetry.track("sync_resolve_applied", {
        files: answered.length,
      });
      return;
    }
    if (outcome === "threw") {
      persistenceTelemetry.track("sync_resolve_apply_failed", {
        reason: "error",
      });
      return;
    }
    // Refused because the copies moved: the view now shows the new ones
    const now = filesOf(PgProjectSync.conflictFor(projectId)) ?? [];
    const moved = movedSince(answered, now);
    if (moved.length) {
      persistenceTelemetry.track("sync_resolve_stale", { files: moved.length });
    } else {
      persistenceTelemetry.track("sync_resolve_apply_failed", {
        reason: "refused",
      });
    }
  };

  const wholeFile = (choice: "keep-local" | "take-server") => {
    persistenceTelemetry.track("sync_whole_file_answered", {
      answer: choice,
      from: "view",
    });
    void answer(choice);
  };

  if (!files) return null;
  return (
    <BaseConflictResolver
      files={files}
      changed={changed}
      busy={busy}
      onApply={(resolved) => void apply(resolved)}
      onKeepLocal={() => wholeFile("keep-local")}
      onTakeServer={() => wholeFile("take-server")}
      onCancel={() => {
        persistenceTelemetry.track("sync_resolve_cancelled", {});
        onClose();
      }}
      onHunkResolved={(how, side) =>
        persistenceTelemetry.track("sync_resolve_hunk_resolved", {
          how,
          side: SIDE_PARAM[side ?? "none"],
        })
      }
    />
  );
};
