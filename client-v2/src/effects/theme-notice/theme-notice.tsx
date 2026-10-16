import { PgTheme, PgView, removedThemeMessage } from "../../utils";

/**
 * Tell a user whose saved theme was removed that they are on Dark now.
 * Effects run after the panels mount, so `Toast` is listening by then.
 */
export const themeNotice = () => {
  const removed = PgTheme.takeRemovedThemeNotice();
  if (removed) {
    // Shown once ever, and a gallery opened over it on a visit with no
    // project would let a self-closing toast vanish unseen
    PgView.setToast(() => <span>{removedThemeMessage(removed)}</span>, {
      options: { autoClose: false },
    });
  }
  return { dispose: () => {} };
};
