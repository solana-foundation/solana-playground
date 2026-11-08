import { report } from "../../features/persistence/model/diagnostics";
import { PgFs } from "../../utils/explorer/fs";
import type { Disposable } from "../../utils/types";

/**
 * Save the file system's folder tree when the page may be about to go away.
 *
 * lightning-fs stores a file's content at once and its folder tree 500 ms
 * after the last write, so a reload or a tab close inside that window loses a
 * file just created: its bytes are stored and nothing lists them. The write
 * helpers (`writeConfigFile`, `writeWorkspaceFile`, the explorer's tree
 * changes) flush where they create a file; this is the backstop for any write
 * that does not, and it costs one tree save per hide rather than work per
 * write.
 *
 * `visibilitychange` to hidden covers a tab switch and an ordinary close;
 * `pagehide` covers a reload, a navigation and the bfcache. A reload fires
 * both, and the second save rewrites the same tree. The save is started inside
 * the event: lightning-fs issues its IndexedDB write from the call itself, so
 * the transaction exists before the document unloads and the browser commits
 * it.
 */
export const fsFlush = (): Disposable => {
  const flush = () => {
    PgFs.flush().catch((e) => report("flush the file tree on page hide", e));
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

// Development only, like `__pgWorkspace` in `tab-reload.ts`: `craco build`
// sets NODE_ENV to production, so this is dropped from the shipped bundle.
// The browser test needs a write that no helper flushes, so that only the
// save on page hide can keep the file through a reload.
if (process.env.NODE_ENV !== "production") {
  (
    window as unknown as {
      __pgFs?: {
        writeUnflushed: (path: string, data: string) => Promise<void>;
      };
    }
  ).__pgFs = {
    writeUnflushed: (path, data) =>
      PgFs.writeFile(path, data, { createParents: true }),
  };
}
