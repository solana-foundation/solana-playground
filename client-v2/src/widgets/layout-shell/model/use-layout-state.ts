import { useCallback, useEffect, useRef, useState } from "react";

import { createLogger } from "@/shared/lib/logger";
import {
  horizontalOf,
  readLayout,
  verticalOf,
  withoutFoldedSizes,
  writeLayout,
} from "./layout-state";
import { DEFAULT_LAYOUT } from "./layout-state";
import type { LayoutPanel, LayoutState, PanelLayout } from "./layout-state";
import { layoutTelemetry } from "./telemetry";
import type { ToggleSource } from "./telemetry";

const log = createLogger("layout-shell:state");

const storage = () => window.localStorage;

/** The layout, restored once per mount, saved on a toggle or a drag */
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

  // Saved on a toggle or a drag, never on mount: a visit that changes nothing
  // leaves what is stored alone. The panel groups report a layout on mount
  // too, and the shell filters those out before they reach `setHorizontal` /
  // `setVertical`. A layout from a newer version is never written over. A
  // folded panel's sizes are dropped here (`withoutFoldedSizes`), so the rule
  // does not depend on the order of the calls that led to the fold.
  const update = useCallback(
    (proposed: LayoutState) => {
      const next = withoutFoldedSizes(proposed);
      latest.current = next;
      setState(next);
      if (keepSaved) return;
      const written = writeLayout(storage, next);
      // Reported once per mount: a full storage fails every save after the
      // first the same way, and `localStorage` is shared with `settings` and
      // `wallet`, so the team must hear that it is full
      if (!written.ok && !reportedSaveFailure.current) {
        reportedSaveFailure.current = true;
        log.error(
          new Error("The layout could not be saved", { cause: written.error }),
          { report: true }
        );
      }
    },
    [keepSaved]
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

  const setHorizontal = useCallback(
    (layout: PanelLayout) => {
      const h = horizontalOf(layout);
      if (h) update({ ...latest.current, h });
      else log.warn("A dragged layout was not saved", { context: { layout } });
    },
    [update]
  );
  const setVertical = useCallback(
    (layout: PanelLayout) => {
      const vert = verticalOf(layout);
      if (vert) update({ ...latest.current, vert });
      else log.warn("A dragged layout was not saved", { context: { layout } });
    },
    [update]
  );

  return { state, setOpen, setHorizontal, setVertical };
};
