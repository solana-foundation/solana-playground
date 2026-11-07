import { CircleAlertIcon, TriangleAlertIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { limitBannerText } from "@/entities/project";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { AsyncButton } from "@/shared/ui/async-button";
import {
  Callout,
  CalloutAction,
  CalloutActions,
  CalloutDescription,
  CalloutTitle,
} from "@/shared/ui/callout";

import { PgExplorer } from "../../../utils/explorer/explorer";
import { PgView } from "../../../utils/view";
import { RenameWorkspace } from "../../../views/sidebar/explorer/Component/Modals/RenameWorkspace";
import type { Conflict, ConflictKind, Resolution } from "../model/project-sync";
import { PgProjectSync } from "../model/project-sync";
import { MAX_PROJECT_BODY_LABEL } from "../model/project-write.mjs";
import { persistenceTelemetry } from "../model/telemetry";
import { ConflictResolver } from "../ui/ConflictResolver";

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
 * conflict that names no files counts every path as open; any other kind has
 * none.
 */
const splitPaths = (conflict: Conflict) => {
  if (conflict.kind !== "divergent") return { open: [], settled: [] };
  const { paths = [], files } = conflict;
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

/**
 * What a banner button does: give an answer (`resolution`, only the answers a
 * button can give alone, since `resolved` carries content), or open the rename
 * dialog for the open project, which is the project the banner is about
 */
type Action = { label: string } & (
  | { kind: "answer"; resolution: Extract<Resolution, string> }
  | { kind: "rename" }
);

/**
 * What the user is shown, and what each answer does. Titles and tones follow
 * the designers' failure-states spec (Spec 08, ACCT-06 to ACCT-09): a question
 * about two copies is a warning, a project that has stopped uploading is an
 * error. The first action is the one the banner expects, after Resolve… where
 * that shows
 */
type Prompt<K extends ConflictKind> = {
  title: string;
  variant: "warning" | "error";
  message: (conflict: Extract<Conflict, { kind: K }>) => string;
  actions: Action[];
};

const PROMPTS: { [K in ConflictKind]: Prompt<K> } = {
  divergent: {
    title: "Changed on another device",
    variant: "warning",
    message: divergentMessage,
    actions: [
      { label: "Keep this version", kind: "answer", resolution: "keep-local" },
      {
        label: "Take the other version",
        kind: "answer",
        resolution: "take-server",
      },
    ],
  },
  "deleted-elsewhere": {
    title: "Deleted on another device",
    variant: "warning",
    message: () =>
      "This project was deleted on another device, but this one has unsaved changes.",
    actions: [
      { label: "Keep a copy", kind: "answer", resolution: "keep-as-new" },
      { label: "Delete anyway", kind: "answer", resolution: "delete-local" },
    ],
  },
  // The two below are refusals rather than questions, so they name the thing
  // the user has to go and change and then offer a retry. The retry is not a
  // convenience: a project with a question outstanding is not pushed again, so
  // without something to press, renaming the project or deleting the file
  // that made it too big would fix the cause and leave it stuck anyway. A
  // taken name also offers the rename itself; renaming still uploads nothing
  // while the question stands, so the retry stays a press of its own
  "name-taken": {
    title: "Not syncing",
    variant: "error",
    message: () =>
      "Another project in your account uses this name. Rename this one, then try again.",
    actions: [
      { label: "Rename", kind: "rename" },
      { label: "Try again", kind: "answer", resolution: "retry" },
    ],
  },
  // A limit names itself and what is over it; the body cap names no limit
  "too-large": {
    title: "Too large to sync",
    variant: "error",
    message: ({ limit }) =>
      limit
        ? limitBannerText(limit)
        : `This project is over ${MAX_PROJECT_BODY_LABEL}. Remove or shrink its largest files, then try again.`,
    actions: [{ label: "Try again", kind: "answer", resolution: "retry" }],
  },
};

/**
 * `conflict`'s prompt, typed for any conflict. TypeScript cannot tie
 * `PROMPTS[conflict.kind]` to `conflict`'s own kind, so the one widening is
 * here: the mapped type above has already checked each entry against its kind.
 */
const promptFor = (conflict: Conflict) =>
  PROMPTS[conflict.kind] as Prompt<ConflictKind> & {
    message: (conflict: Conflict) => string;
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
    // TODO(HOO-2602): a project refused while not open (reconcile,
    // `pushNeverSynced`) shows nothing until it is opened. The account cap
    // (HOO-2538) meets this most: a device signing in with more unsynced
    // projects than the account can take learns of each only on opening it.
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

  /** What pressing `action` does, and what a failure says did not happen */
  const pressOf = (action: Action) =>
    action.kind === "rename"
      ? {
          run: () => PgView.setModal(RenameWorkspace),
          failure: "rename the project",
        }
      : { run: () => answer(action.resolution), failure: "apply your choice" };

  const renderBanner = (shown: Conflict) => {
    const prompt = promptFor(shown);
    // Line by line needs the lines: a divergence the merge never got as far as
    // naming files keeps the two whole-project answers only
    const resolvable = shown.kind === "divergent" && !!shown.files?.length;
    const message = prompt.message(shown);

    const named = namedPath(shown);
    const at = named ? message.indexOf(named) : -1;
    const Icon =
      prompt.variant === "error" ? CircleAlertIcon : TriangleAlertIcon;

    return (
      <Callout variant={prompt.variant} data-testid="sync-banner">
        <Icon />
        <CalloutTitle>{prompt.title}</CalloutTitle>
        <CalloutDescription>
          <p className="m-0 text-foreground wrap-anywhere">
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
        </CalloutDescription>
        <CalloutActions>
          {prompt.actions.map((action) => {
            const { run, failure } = pressOf(action);
            return (
              <CalloutAction key={action.label} asChild>
                <AsyncButton
                  size="sm"
                  disabled={busy}
                  onClick={run}
                  onError={reportButtonFailure(failure)}
                >
                  {action.label}
                </AsyncButton>
              </CalloutAction>
            );
          })}
          {resolvable && (
            <CalloutAction
              disabled={busy || !!resolving}
              onClick={() => setResolving(shown.projectId)}
            >
              Resolve…
            </CalloutAction>
          )}
        </CalloutActions>
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
