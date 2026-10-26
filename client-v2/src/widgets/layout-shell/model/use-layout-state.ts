import { useCallback, useEffect, useRef, useState } from "react";

import { createLogger } from "@/shared/lib/logger";
import {
  horizontalOf,
  readLayout,
  verticalOf,
  withoutFoldedSizes,
  workOf,
  writeLayout,
} from "./layout-state";
import { DEFAULT_LAYOUT } from "./layout-state";
import type {
  LayoutPanel,
  LayoutState,
  PanelLayout,
  SizeKey,
} from "./layout-state";
import { layoutTelemetry } from "./telemetry";
import type { ToggleSource } from "./telemetry";

const log = createLogger("layout-shell:state");

const storage = () => window.localStorage;

/**
 * The layout, restored once per mount, saved on a toggle or a drag, and once
 * on mount when a version 1 value was converted
 */
export const useLayoutState = () => {
  const [restored] = useState(() => readLayout(storage));
  const [state, setState] = useState<LayoutState>(
    restored.kind === "saved" ? restored.state : DEFAULT_LAYOUT
  );
  // Mirrors `state` synchronously, so two toggles in one tick each see the
  // other, and the event is sent outside any `setState` updater
  const latest = useRef(state);
  // A layout from a newer version is kept as it is: this one cannot read it,
  // and writing would replace it with a layout its own version cannot use
  const keepSaved = restored.kind === "failed" && restored.reason === "version";
  // Storage the read could not reach fails the save the same way, and the
  // read has reported it already
  const reportedSaveFailure = useRef(
    restored.kind === "failed" && restored.reason === "storage-unavailable"
  );

  useEffect(() => {
    if (restored.kind === "saved") {
      if (restored.dropped.length === 0) return;
      // Reported: a library upgrade that changes how sizes are reported
      // would reset every returning user's sizes, and only this would say so
      log.warn("Saved panel sizes were unreadable and were dropped", {
        report: true,
        context: { dropped: restored.dropped },
      });
      return;
    }
    if (restored.kind !== "failed") return;
    if (restored.reason === "version") {
      // Reported: version skew leaves this build unable to save the layout
      // for the whole visit
      log.warn(
        "The saved layout is from a newer version; using the defaults and not overwriting it",
        { report: true }
      );
    } else {
      log.error(restored.error, {
        report: true,
        context: { reason: restored.reason, using: "defaults" },
      });
    }
    layoutTelemetry.track("layout_restore_failed", { reason: restored.reason });
  }, [restored]);

  // Reported once per mount: a full storage fails every save after the
  // first the same way, and `localStorage` is shared with `settings` and
  // `wallet`, so the team must hear that it is full
  // `during` tells the report which write failed: the first failure of a
  // visit is the migration's when a version 1 value was converted on mount
  const save = useCallback(
    (next: LayoutState, during: "save" | "migration" = "save") => {
      const written = writeLayout(storage, next);
      if (!written.ok && !reportedSaveFailure.current) {
        reportedSaveFailure.current = true;
        log.error(
          new Error("The layout could not be saved", { cause: written.error }),
          { report: true, context: { during } }
        );
      }
    },
    []
  );

  // A version 1 value is rewritten as version 2 once, so the next visit reads
  // the current shape. The ref keeps StrictMode's second run of the effect
  // from writing it again.
  const migrationSaved = useRef(false);
  useEffect(() => {
    if (restored.kind !== "saved" || !restored.migrated) return;
    if (migrationSaved.current) return;
    migrationSaved.current = true;
    // Version 1's `h` sized panels that the horizontal group does not have, so
    // `migrateV1` drops it by design: said here, not reported, so a reader of
    // the logs does not take the missing sizes for a loss. Only when the
    // value held an `h`, so the line never reports a drop that did not happen.
    if (restored.droppedH) {
      log.info(
        "A version 1 layout was migrated; its horizontal sizes were not carried over because their panels changed",
        { context: { from: 1 } }
      );
    }
    save(restored.state, "migration");
  }, [restored, save]);

  // Saved on a toggle or a drag, never on mount (a migrated layout aside): a
  // visit that changes nothing leaves what is stored alone. The panel groups
  // report a layout on mount too, and the shell filters those out before they
  // reach `setHorizontal` / `setWork` / `setVertical`. A layout from a newer
  // version is never written over. A folded panel's sizes are dropped here
  // (`withoutFoldedSizes`), so the rule does not depend on the order of the
  // calls that led to the fold.
  const update = useCallback(
    (proposed: LayoutState) => {
      const next = withoutFoldedSizes(proposed);
      latest.current = next;
      setState(next);
      if (keepSaved) return;
      save(next);
    },
    [keepSaved, save]
  );

  const setOpen = useCallback(
    (
      panel: LayoutPanel,
      { open, via }: { open: boolean; via: ToggleSource }
    ) => {
      if (latest.current.open[panel] === open) return;
      layoutTelemetry.track("layout_panel_toggled", { panel, open, via });
      update({
        ...latest.current,
        open: { ...latest.current.open, [panel]: open },
      });
    },
    [update]
  );

  // Reported once per mount: a refused drag means the panel library reported
  // a layout `horizontalOf` / `workOf` / `verticalOf` do not recognise (a
  // renamed or missing panel id), so every drag of the visit is lost the same
  // way; the team hears of it once, and later refusals only warn
  const reportedRefusedLayout = useRef(false);
  const refuse = useCallback((group: SizeKey, layout: PanelLayout) => {
    const report = !reportedRefusedLayout.current;
    reportedRefusedLayout.current = true;
    log.warn("A dragged layout was not saved", {
      report,
      context: { group, layout },
    });
  }, []);

  const setHorizontal = useCallback(
    (layout: PanelLayout) => {
      const h = horizontalOf(layout);
      if (h) update({ ...latest.current, h });
      else refuse("h", layout);
    },
    [update, refuse]
  );
  const setWork = useCallback(
    (layout: PanelLayout) => {
      const w = workOf(layout);
      if (w) update({ ...latest.current, w });
      else refuse("w", layout);
    },
    [update, refuse]
  );
  const setVertical = useCallback(
    (layout: PanelLayout) => {
      const vert = verticalOf(layout);
      if (vert) update({ ...latest.current, vert });
      else refuse("vert", layout);
    },
    [update, refuse]
  );

  return { state, setOpen, setHorizontal, setWork, setVertical };
};
