import { useEffect, useReducer, useRef, useState } from "react";

import { useTutorialProgress } from "@/entities/tutorial";
import { createLogger } from "@/shared/lib/logger";
import { ExplorerLimitError, PgExplorer, PgTutorial, PgView } from "@/utils";
import { PgWorkspace } from "@/utils/explorer/workspace";
import {
  DeleteWorkspace,
  ExportWorkspace,
} from "@/views/sidebar/explorer/Component/Modals";

import { copyName } from "../model/copy-name";
import {
  PINS_KEY,
  prunePins,
  readPins,
  togglePin,
  writePins,
} from "../model/pins";
import type { ProjectAction } from "../model/project-action";
import type { ProjectEntry } from "../model/project-entries";
import { listProjects } from "../model/project-entries";
import { navTelemetry } from "../model/telemetry";
import {
  readProjectFiles,
  readWorkspaceFiles,
  rebaseFiles,
} from "../model/workspace-files";
import type { BaseProjectListProps } from "./BaseProjectList";
import BaseProjectList from "./BaseProjectList";
import { useSyncMarkers } from "./use-sync-markers";

const log = createLogger("app-nav:projects");

/** How a failure toast names what did not happen */
const VERB: Record<ProjectAction, string> = {
  open: "open",
  pin: "pin",
  unpin: "unpin",
  rename: "rename",
  duplicate: "duplicate",
  export: "export",
  "share-gist": "share",
  delete: "delete",
};

const INVALID_NAME = "Use letters, numbers, spaces, - or _.";
const NAME_TAKEN = "A project already has that name.";

/**
 * A rename the explorer refused for a reason the user can act on: the project
 * went (renamed or deleted elsewhere) or the name was taken meanwhile. Said
 * in the field, not reported: another tab or device is all it takes.
 */
const refusalOf = (error: unknown, entry: ProjectEntry) => {
  const message = error instanceof Error ? error.message : undefined;
  if (message === PgWorkspace.errors.NOT_FOUND) {
    return `${entry.name} is no longer in your projects.`;
  }
  if (message === PgWorkspace.errors.ALREADY_EXISTS) {
    return NAME_TAKEN;
  }
  return undefined;
};

/**
 * An `Error` for whatever an action threw, so the logger never records a
 * plain `{ message }` as "[object Object]"
 */
const asError = (thrown: unknown) => {
  if (thrown instanceof Error) return thrown;
  if (
    typeof thrown === "object" &&
    thrown !== null &&
    "message" in thrown &&
    typeof thrown.message === "string"
  ) {
    return new Error(thrown.message);
  }
  return new Error(String(thrown));
};

export type ProjectListProps = {
  /** The project already open was picked: no switch, the page shows it */
  onPickCurrent?: () => void;
  /**
   * A project or lesson was picked and is open, the one already open
   * included: a page over the work makes way for it
   */
  onPicked?: () => void;
  /**
   * Opens the share dialog for a project; settles when it closes. The
   * dialog's frame and sign-in belong to slices a widget may not import, so
   * the page hands the opener in.
   */
  onShareGist?: (
    readFiles: () => Promise<Record<string, string>>,
    name: string
  ) => Promise<unknown>;
  /** EMPTY-01's ways in, drawn once the explorer holds no project */
  empty?: BaseProjectListProps["empty"];
};

/**
 * The navigation's project list, connected: the explorer's workspaces, the
 * device's pins, each project's sync marker, each lesson's progress, and what
 * each menu item does. A failed action tells the
 * user, is logged for the team, and is counted.
 */
const ProjectList = ({
  onPickCurrent,
  onPicked,
  onShareGist,
  empty,
}: ProjectListProps) => {
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const [pins, setPins] = useState(readPins);
  const markers = useSyncMarkers();
  const progressOf = useTutorialProgress();
  const [renaming, setRenaming] = useState<string | undefined>();
  const [renameError, setRenameError] = useState<string | undefined>();
  // How the rename was asked for: it is counted on commit, with that `via`
  const renameVia = useRef<"click" | "key">("click");
  // A second Enter, or the blur after it, must not start a second rename of
  // a name the first one is moving away from
  const renamePending = useRef(false);
  // A storage that refuses the stale-pin cleanup refuses it on every render
  const cleanupFailed = useRef(false);

  // A project synced from another device arrives without a switch -- it is
  // deliberately not opened -- so creation is listened to as well, and a
  // list taken from another tab or renamed by sync has its own event
  useEffect(() => {
    const subscriptions = [
      PgExplorer.onDidCreateWorkspace(refresh),
      PgExplorer.onDidRenameWorkspace(refresh),
      PgExplorer.onDidDeleteWorkspace(refresh),
      PgExplorer.onDidSwitchWorkspace(refresh),
      PgExplorer.onDidChangeWorkspaceList(refresh),
    ];
    return () => subscriptions.forEach((s) => s.dispose());
  }, []);

  // Another tab's pins
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === PINS_KEY) setPins(readPins());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Stored, not in memory: a repository, gist or docs link's view holds no
  // list of its own, and the user's projects stay listed beside it
  const names = PgExplorer.storedWorkspaceNames ?? [];
  const liveIds = names
    .map((name) => PgExplorer.storedWorkspaceIdOf(name))
    .filter((id): id is string => id !== undefined);
  const livePins = prunePins(pins, liveIds);

  // A pin whose workspace is gone (deleted here or on another device) is
  // dropped from storage once the explorer has loaded what it has; before
  // that, every pin would look gone
  const stale = liveIds.length > 0 && livePins.length !== pins.length;
  const liveKey = liveIds.join();
  useEffect(() => {
    if (!stale || cleanupFailed.current) return;
    const kept = prunePins(readPins(), liveKey.split(","));
    try {
      writePins(kept);
      setPins(kept);
    } catch (e) {
      // Nothing the user did: the dropped pins are only left in storage, and
      // are left out of the list all the same
      cleanupFailed.current = true;
      log.warn("stale pins could not be dropped", { context: { e } });
    }
  }, [stale, liveKey]);

  // The project being renamed went (renamed or deleted elsewhere): its field
  // goes with it, rather than come back on a project of that name later
  const renamingGone = renaming !== undefined && !names.includes(renaming);
  useEffect(() => {
    if (!renamingGone) return;
    setRenaming(undefined);
    setRenameError(undefined);
  }, [renamingGone]);

  const projects = listProjects(
    names,
    {
      idOf: (name) => PgExplorer.storedWorkspaceIdOf(name),
      isLesson: (name) => PgTutorial.isWorkspaceTutorial(name),
      markerOf: (name) => markers.get(name),
      progressOf,
    },
    livePins
  );

  const fail = (entry: ProjectEntry, action: ProjectAction, e: unknown) => {
    // A project over a limit is refused a copy on purpose (the explorer
    // sends its own event); the toast says which limit, and nothing is
    // reported
    const limit = e instanceof ExplorerLimitError ? e.message : null;
    if (limit) {
      log.warn("refused by a project limit", { context: { action, limit } });
    } else {
      log.error(asError(e), {
        report: true,
        context: { action, isLesson: entry.isLesson },
      });
    }
    navTelemetry.track("nav_project_action_failed", { action });
    PgView.setToast(
      () => (
        <span>
          Could not {VERB[action]} {entry.name}.{limit && ` ${limit}`}
        </span>
      ),
      { options: { name: `project-${action}-failed` } }
    );
  };

  const perform = async (entry: ProjectEntry, action: ProjectAction) => {
    switch (action) {
      case "open":
        // Already open: the page may show Home over it, and goes back to it
        if (entry.name === PgExplorer.currentWorkspaceName) {
          onPicked?.();
          onPickCurrent?.();
          return;
        }
        if (entry.isLesson) await PgTutorial.open(entry.name);
        else await PgExplorer.switchWorkspace(entry.name);
        // Only once the pick is open: a page closed before it would send the
        // address bar back to the project that was open
        onPicked?.();
        return;
      case "pin":
      case "unpin": {
        if (!entry.id) {
          // The explorer has not given it an id yet; nothing to key a pin on
          log.warn("pin skipped: workspace has no id yet");
          return;
        }
        // From storage, not this tab's copy: another tab may have pinned since
        const next = togglePin(prunePins(readPins(), liveIds), entry.id);
        writePins(next);
        setPins(next);
        return;
      }
      case "rename":
        setRenameError(undefined);
        setRenaming(entry.name);
        return;
      case "duplicate": {
        const copy = copyName(entry.name, names);
        const files = await readWorkspaceFiles(entry.name, PgExplorer.fs);
        await PgExplorer.createWorkspace(copy, {
          files: rebaseFiles(files, entry.name, copy),
        });
        return;
      }
      case "export":
        // The promise settles when the dialog closes, with `null` if it
        // crashed (`ModalHost` reports that); the dialog reports its own
        // export's failures
        await PgView.setModal(<ExportWorkspace name={entry.name} />);
        return;
      case "share-gist":
        if (!onShareGist) {
          log.warn("share skipped: no share dialog was handed in");
          return;
        }
        // The dialog reports and counts its own failures
        await onShareGist(
          () => readProjectFiles(entry.name, PgExplorer.fs),
          entry.name
        );
        return;
      case "delete":
        await PgView.setModal(
          <DeleteWorkspace name={entry.name} isLesson={entry.isLesson} />
        );
        return;
    }
  };

  const onAction = (
    entry: ProjectEntry,
    action: ProjectAction,
    via: "click" | "key"
  ) => {
    // A rename is counted when it is committed, not when the field opens
    if (action === "rename") renameVia.current = via;
    else navTelemetry.track("nav_project_action", { action, via });
    perform(entry, action).catch((e: unknown) => fail(entry, action, e));
  };

  const onRenameCommit = async (entry: ProjectEntry, value: string) => {
    if (renamePending.current) return;
    const newName = value.trim();
    if (!PgExplorer.isWorkspaceNameValid(newName)) {
      setRenameError(INVALID_NAME);
      return;
    }
    if (newName === entry.name) {
      setRenaming(undefined);
      return;
    }
    if (names.includes(newName)) {
      setRenameError(NAME_TAKEN);
      return;
    }

    navTelemetry.track("nav_project_action", {
      action: "rename",
      via: renameVia.current,
    });
    renamePending.current = true;
    try {
      // Another workspace is renamed where it lies, and announced so sync
      // uploads the new name; the open one is renamed as before
      await PgExplorer.renameWorkspace(newName, {
        from: entry.name,
        announce: true,
      });
      setRenaming(undefined);
      setRenameError(undefined);
    } catch (e) {
      const refusal = refusalOf(e, entry);
      if (refusal) {
        navTelemetry.track("nav_project_action_failed", { action: "rename" });
        setRenameError(refusal);
        return;
      }
      fail(entry, "rename", e);
      setRenameError(`Could not rename ${entry.name}.`);
    } finally {
      renamePending.current = false;
    }
  };

  return (
    <BaseProjectList
      projects={projects}
      // A temporary view reads its stored list during init, so one left
      // without names failed that read: it lists nothing rather than loading
      // for good
      loading={
        !PgExplorer.isTemporary && PgExplorer.storedWorkspaceNames === undefined
      }
      current={PgExplorer.currentWorkspaceName}
      renaming={renamingGone ? undefined : renaming}
      renameError={renameError}
      onAction={onAction}
      onRenameChange={() => setRenameError(undefined)}
      onRenameCommit={onRenameCommit}
      onRenameCancel={() => {
        if (renamePending.current) return;
        setRenaming(undefined);
        setRenameError(undefined);
      }}
      // A preview has no workspaces of its own, which is not "no projects"
      empty={PgExplorer.isTemporary ? undefined : empty}
    />
  );
};

export default ProjectList;
