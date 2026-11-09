import { useCallback, useEffect, useState } from "react";

import { useBlockDismiss } from "@/widgets/overlays";

/**
 * Whether any key panel in a dialog is busy. While one is, this hook blocks
 * the dialog's dismissal itself (Escape, a press outside, the header's
 * Close, through `ModalHost`'s `useBlockDismiss`), and the caller holds its
 * submit with `isBusy`: either would close the dialog, and the panel's port
 * with it, before the panel's result reaches the dialog.
 *
 * @returns whether one is (for the submit), and the `onBusy` to give each
 * panel
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
