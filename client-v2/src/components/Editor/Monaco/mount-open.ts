/**
 * Tells the open the editor makes as it mounts from the ones after it.
 *
 * `PgExplorer.onDidOpenFile` replays the current file as it subscribes, and
 * that replay is the mount's open. A replay with no current file opens
 * nothing, so the first file that does open is still the mount's: spending
 * the mount on the empty replay would let that open take focus from a field
 * the user is typing in. Every open after it is a later one, whoever makes
 * it: the user (the explorer, a tab, creating a file) or the program (sync
 * re-opening the workspace after a merge or an adoption).
 */
export const createMountOpen = () => {
  let pending = true;
  return (file: object | null): boolean => {
    if (!file) return false;
    const isMountOpen = pending;
    pending = false;
    return isMountOpen;
  };
};
