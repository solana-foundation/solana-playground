import { useCallback, useEffect, useState } from "react";
import { TriangleAlertIcon } from "lucide-react";

import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { AsyncButton } from "@/shared/ui/async-button";
import { Button } from "@/shared/ui/button";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import { ConflictResolver } from "../ui/ConflictResolver";
import { PgProjectSync } from "../model/project-sync";
import { MAX_PROJECT_BODY_LABEL } from "../model/project-write.mjs";
import { persistenceTelemetry } from "../model/telemetry";
import { PgExplorer } from "../../../utils/explorer/explorer";
import type { Conflict, Resolution } from "../model/project-sync";

/** `src/lib.rs`, or `src/lib.rs and 2 other files` */
const describePaths = (paths: string[]) =>
  paths.length === 1
    ? paths[0]
    : `${paths[0]} and ${paths.length - 1} other file${
        paths.length > 2 ? "s" : ""
      }`;

/**
 * A divergent conflict's files, by whether they still conflict (`open`) or
 * were raised again only because a refused answer was about them, and now
 * merge on their own (`settled`; see `refusedOf` in `project-sync.ts`). A
 * conflict that names no files counts every path as open.
 */
const splitPaths = ({ paths = [], files }: Conflict) => {
  if (!files) return { open: paths, settled: [] };
  const settled = files.filter((f) => f.kind === "settled").map((f) => f.path);
  const open = files.filter((f) => f.kind !== "settled").map((f) => f.path);
  return { open, settled };
};

/** The path a message names first, set in code style */
const namedPath = (conflict: Conflict) => {
  const { open, settled } = splitPaths(conflict);
  return open[0] ?? settled[0];
};

/**
 * What a divergent conflict says. Everything else has already been merged by
 * the time this shows, so it names what is left rather than offering to
 * replace the whole project -- unless an answer was refused, in which case
 * files it was about wait, unmerged, for the user to look again.
 */
const divergentMessage = (conflict: Conflict) => {
  const { open, settled } = splitPaths(conflict);
  if (open.length) {
    const same = `${describePaths(
      open
    )} changed on another device and on this one, in the same place.`;
    return settled.length
      ? `${same} Other files changed again while you were resolving; review them before applying.`
      : `${same} Everything else was merged.`;
  }
  if (settled.length) {
    return `${describePaths(
      settled
    )} changed on another device while you were resolving. Review before applying.`;
  }
  return "This project changed on another device, and this one has unsaved changes.";
};

/** What the user is shown, and what each answer does */
const PROMPTS: Record<
  Conflict["kind"],
  {
    message: (conflict: Conflict) => string;
    // Only the answers a button can give alone; `resolved` carries content
    actions: {
      label: string;
      resolution: Extract<Resolution, string>;
      primary?: boolean;
    }[];
  }
> = {
  divergent: {
    message: divergentMessage,
    actions: [
      { label: "Keep this version", resolution: "keep-local", primary: true },
      { label: "Take the other version", resolution: "take-server" },
    ],
  },
  "deleted-elsewhere": {
    message: () =>
      "This project was deleted on another device, but you have unsaved changes here.",
    actions: [
      {
        label: "Keep as a new project",
        resolution: "keep-as-new",
        primary: true,
      },
      { label: "Delete anyway", resolution: "delete-local" },
    ],
  },
  // The two below are refusals rather than questions, so they name the thing
  // the user has to go and change and then offer the one answer there is. The
  // retry is not a convenience: a project with a question outstanding is not
  // pushed again, so without something to press, renaming the project or
  // deleting the file that made it too big would fix the cause and leave it
  // stuck anyway.
  "name-taken": {
    message: () =>
      "Another project in your account already uses this name, so this one cannot be uploaded. Rename it, then try again.",
    actions: [{ label: "Try again", resolution: "retry", primary: true }],
  },
  "too-large": {
    message: () =>
      `This project is over the ${MAX_PROJECT_BODY_LABEL} sync limit. Remove or shrink its largest files, then try again.`,
    actions: [{ label: "Try again", resolution: "retry", primary: true }],
  },
};

/**
 * Say why a project has stopped syncing, and offer the way out.
 *
 * Mostly that means asking which copy to keep, because the failure this
 * prevents is "I opened the project on my phone and lost an afternoon on my
 * laptop". Asked only about what a merge could not settle -- lines both
 * devices changed. Anything that overlaps, or merely touches, is a question
 * rather than a guess, because a bad merge is worse than a question.
 *
 * It is the *only* place the user is asked anything. Every other outcome --
 * taking the server's copy, pushing this device's, finishing a delete -- is
 * decided by `reconcile` without involving them, because in those cases only
 * one side has work in it.
 *
 * The refusals (`name-taken`, `too-large`) are here for a different reason:
 * not because there is a choice to make, but because a project that has
 * stopped uploading is otherwise indistinguishable from one that is up to
 * date. Silence is the wrong answer to "your work is no longer being saved".
 *
 * Shown for the current workspace only, and re-read on every change to the
 * outstanding set. It used to subscribe to a raise-only event and so stayed on
 * screen for the rest of the session once triggered, including over unrelated
 * projects.
 */
const SyncBanner = () => {
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [busy, setBusy] = useState(false);
  // The project whose resolve view is open. Kept apart from `conflict`: an
  // answer clears the question before it uploads, and the view decides for
  // itself whether that means it is done
  const [resolving, setResolving] = useState<string | null>(null);
  const closeResolver = useCallback(() => setResolving(null), []);

  const refresh = useCallback(() => {
    setConflict(PgProjectSync.conflictFor(PgExplorer.currentWorkspaceId));
  }, []);

  useEffect(() => {
    refresh();
    const subscriptions = [
      PgProjectSync.onDidChangeConflicts(refresh),
      // A conflict belongs to a project, so switching away from it has to take
      // the banner with it
      PgExplorer.onDidSwitchWorkspace(refresh),
    ];
    return () => {
      for (const sub of subscriptions) sub.dispose();
    };
  }, [refresh]);

  const answer = async (resolution: Resolution) => {
    if (!conflict) return;
    if (resolution === "keep-local" || resolution === "take-server") {
      persistenceTelemetry.track("sync_whole_file_answered", {
        answer: resolution,
        from: "banner",
      });
    }
    setBusy(true);
    try {
      // A resolution that failed -- offline, or the server refused again --
      // leaves the prompt up. Clearing it here would strand the project with
      // nothing on screen to say so.
      await PgProjectSync.resolve(conflict.projectId, resolution);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const renderBanner = (conflict: Conflict) => {
    const prompt = PROMPTS[conflict.kind];
    // Line by line needs the lines: a divergence the merge never got as far as
    // naming files keeps the two whole-project answers only
    const resolvable =
      conflict.kind === "divergent" && !!conflict.files?.length;
    const message = prompt.message(conflict);

    const named = namedPath(conflict);
    const at = named ? message.indexOf(named) : -1;

    return (
      <Callout variant="warning">
        <TriangleAlertIcon />
        {/* Message left, buttons right; the buttons drop below when it gets
            narrow. Full opacity: the message is the point of the banner */}
        <CalloutDescription className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 opacity-100">
          <p className="m-0 flex-[1_1_20rem] text-foreground wrap-anywhere">
            {named && at >= 0 ? (
              <>
                {message.slice(0, at)}
                <code className="rounded-sm bg-background px-1.5 py-px font-mono text-xs">
                  {named}
                </code>
                {message.slice(at + named.length)}
              </>
            ) : (
              message
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {resolvable && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy || !!resolving}
                onClick={() => setResolving(conflict.projectId)}
              >
                Resolve…
              </Button>
            )}
            {prompt.actions.map((action) => (
              <AsyncButton
                key={action.resolution}
                variant={action.primary ? "default" : "outline"}
                size="sm"
                disabled={busy}
                onClick={() => answer(action.resolution)}
                onError={reportButtonFailure("apply your choice")}
              >
                {action.label}
              </AsyncButton>
            ))}
          </div>
        </CalloutDescription>
      </Callout>
    );
  };

  // Beside the banner rather than in it, so the view stays mounted, choices
  // and all, while an answer briefly clears the question
  return (
    <>
      {conflict && renderBanner(conflict)}
      {resolving && (
        <ConflictResolver projectId={resolving} onClose={closeResolver} />
      )}
    </>
  );
};

export default SyncBanner;
