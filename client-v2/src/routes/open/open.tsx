import {
  backToDocsHref,
  BaseBrokenLink,
  decodeDocsLink,
  docsLinkTelemetry,
  PgDocsLink,
} from "@/features/docs-link";

import { PgExplorer, PgRouter } from "../../utils";
import { handleRoute } from "../common";

/**
 * Open a link pasted over the one open: only the fragment changes, which
 * loads no page and runs no route, so the project would stay the old one.
 *
 * @returns a disposable that stops listening
 */
const followNewLinks = () => {
  const reload = () => window.location.reload();
  window.addEventListener("hashchange", reload);
  return { dispose: () => window.removeEventListener("hashchange", reload) };
};

/**
 * `/open#v=1&name=…&code=…`: the docs' "Open in Playground". The file opens
 * as an unsaved client project, as a gist link does; a fragment that does
 * not decode shows "This link is broken" instead.
 */
export const open = PgRouter.create({
  path: "/open",
  handle: () => {
    const reopen = followNewLinks();
    const decoded = decodeDocsLink(window.location.hash);

    if (!decoded.ok) {
      docsLinkTelemetry.track("docs_link_failed", { reason: decoded.reason });
      PgDocsLink.markBroken();
      const backHref = backToDocsHref(decoded.from, document.referrer);
      const route = handleRoute({
        main: async () => (
          <BaseBrokenLink
            backHref={backHref}
            onHome={() => PgRouter.navigate("/")}
          />
        ),
      });
      return {
        dispose: () => {
          route.dispose();
          reopen.dispose();
          PgDocsLink.clear();
        },
      };
    }

    const { link } = decoded;
    // Another project opened from the tree or the list leaves the path at
    // `/open`: its project did not come from this link. Saving the link's
    // project into a workspace switches too, and it is the user's own then
    const leave = PgExplorer.onDidSwitchWorkspace(() => PgDocsLink.clear());
    const route = handleRoute({
      getExplorerInitArg: () => {
        PgDocsLink.open(link);
        docsLinkTelemetry.track("docs_link_opened", {
          host: link.from ? new URL(link.from).hostname : "none",
          bytes: new TextEncoder().encode(link.code).length,
        });
        return {
          files: [
            [`${PgExplorer.PATHS.CLIENT_DIRNAME}/${link.name}`, link.code],
          ],
        };
      },
    });

    return {
      dispose: () => {
        route.dispose();
        reopen.dispose();
        leave.dispose();
        // Another route took over: its project did not come from this link
        PgDocsLink.clear();
      },
    };
  },
});
