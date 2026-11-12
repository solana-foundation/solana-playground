import { useCallback, useEffect, useRef, useState } from "react";

import { useBlockDismiss } from "@/widgets/overlays";

/**
 * Whether any key panel in a dialog is busy. While one is, this hook blocks
 * the dialog's dismissal itself (Escape, a press outside, the header's
 * Close, through `ModalHost`'s `useBlockDismiss`), and the caller holds its
 * submit and Cancel by passing `isBusy` as the frame's `isHeld`: any of them
 * would close the dialog, and the panel's port with it, before the panel's
 * result reaches the dialog.
 *
 * A submit that awaits something can still be pressed before a panel starts,
 * so it awaits `whenIdle` before it closes the dialog.
 *
 * @returns whether one is (for the submit), the `onBusy` to give each panel,
 * and `whenIdle`, which resolves once no panel is busy
 */
export const useBusyPanels = () => {
  const [count, setCount] = useState(0);
  // The count again, and who waits for it to reach 0, outside React's render
  // cycle: a submit's async handler reads it after its own await
  const live = useRef({ count: 0, waiters: [] as (() => void)[] });
  const onBusy = useCallback((busy: boolean) => {
    const state = live.current;
    state.count = Math.max(0, state.count + (busy ? 1 : -1));
    setCount(state.count);
    if (state.count > 0) return;
    const waiters = state.waiters.splice(0);
    for (const resolve of waiters) resolve();
  }, []);
  const whenIdle = useCallback(
    () =>
      new Promise<void>((resolve) => {
        if (live.current.count === 0) resolve();
        else live.current.waiters.push(resolve);
      }),
    []
  );
  const isBusy = count > 0;
  const blockDismiss = useBlockDismiss();
  useEffect(() => {
    if (!isBusy) return;
    return blockDismiss();
  }, [isBusy, blockDismiss]);
  return { isBusy, onBusy, whenIdle };
};
