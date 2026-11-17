import { report } from "../../features/persistence/model/diagnostics";
import { PgFs } from "../../utils/explorer/fs";
import type { Disposable } from "../../utils/types";

/**
 * Save the file system's folder tree when the page is hidden.
 *
 * lightning-fs stores a file's content at once and its folder tree 500 ms
 * after the last write, so a page that goes away inside that window loses a
 * file just created: its bytes are stored and nothing lists them. A hidden
 * page may be frozen or discarded without another event (a mobile app
 * switch, a tab the browser reclaims), so the tree is saved as it is hidden.
 * That costs at most one tree save per hide, never work per write, and none
 * when the file system is idle: lightning-fs saves the tree itself when it
 * deactivates, 500 ms after its last operation, and a flush after that saves
 * nothing.
 *
 * This does not cover a reload or a close, measured in Chromium: it aborts an
 * IndexedDB transaction still open when the document unloads, so a save
 * started in `pagehide`, or in the `hidden` change that comes with an unload,
 * never lands, and its failure is never reported either. Other engines are
 * unmeasured. A file must survive those through a save when it is created,
 * which the write helpers do (`writeConfigFile`, `writeWorkspaceFile`, the
 * explorer's tree changes). `pagehide` is listened to for a browser that
 * leaves a page without the `hidden` change; when both fire, the second
 * finds the first save still running and starts none.
 */
export const fsFlush = (): Disposable => {
  let saving: Promise<void> | undefined;

  const flush = () => {
    if (saving) return;
    saving = PgFs.flush()
      .catch((e) => report("flush the file tree on page hide", e))
      .finally(() => {
        saving = undefined;
      });
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") flush();
  };

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", flush);

  return {
    dispose: () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", flush);
    },
  };
};
