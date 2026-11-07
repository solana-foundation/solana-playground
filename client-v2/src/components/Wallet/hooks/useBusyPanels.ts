import { useCallback, useState } from "react";

/**
 * Whether any key panel in a dialog is busy, so the dialog holds its submit
 * meanwhile: a submit then would close the dialog and lose the panel's result
 *
 * @returns whether one is, and the `onBusy` to give each panel
 */
export const useBusyPanels = () => {
  const [count, setCount] = useState(0);
  const onBusy = useCallback(
    (busy: boolean) => setCount((n) => Math.max(0, n + (busy ? 1 : -1))),
    []
  );
  return { isBusy: count > 0, onBusy };
};
