import { useCallback, useEffect, useState } from "react";

import { useBlockDismiss } from "@/widgets/overlays";

/**
 * Whether any key panel in a dialog is busy, so the dialog holds its submit
 * and its dismissal (Escape, a press outside, the header's Close) meanwhile:
 * either would close the dialog, and the panel's port with it, before the
 * panel's result reaches the dialog
 *
 * @returns whether one is, and the `onBusy` to give each panel
 */
export const useBusyPanels = () => {
  const [count, setCount] = useState(0);
  const onBusy = useCallback(
    (busy: boolean) => setCount((n) => Math.max(0, n + (busy ? 1 : -1))),
    []
  );
  const isBusy = count > 0;
  const blockDismiss = useBlockDismiss();
  useEffect(() => {
    if (!isBusy) return;
    blockDismiss(true);
    return () => blockDismiss(false);
  }, [isBusy, blockDismiss]);
  return { isBusy, onBusy };
};
