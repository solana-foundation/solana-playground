import {
  Disposable,
  PgCommon,
  PgExplorer,
  PgRouter,
  PgTutorial,
  PgView,
  TutorialFullData,
} from "../../utils";
import { handleRoute } from "../common";
import { openPageFromLink } from "../open-page-from-link";

export const tutorials = PgRouter.create({
  path: "/tutorials/{name}/{page}",
  handle: ({ name, page }) => {
    if (name) return handleTutorial(name, page);
    // The bare list is a page now: open it, over the work or Home on `/`
    openPageFromLink("tutorials");
  },
});

let disposables: Disposable[] = [];
let isTutorialInView = false;
let mainSecondaryHeight = 0;

// The sidebar change this route makes itself, which its own listener must
// not read as the user leaving the lesson. Module scope, beside
// `isTutorialInView`: the listener is registered on the first route call
// only, and later calls set this for that same listener to read.
let ownSidebarChange: SidebarPageName | undefined;

const handleTutorial = (name: string, page: string) => {
  // Get the tutorial
  const tutorial = PgTutorial.all.find((t) => {
    return PgRouter.isPathsEqual(PgCommon.toKebabFromTitle(t.name), name);
  });

  // Check whether the tutorial exists
  if (!tutorial) {
    return handleRoute({
      main: {
        name: "NotFound",
        props: {
          text: `Tutorial not found: ${PgCommon.toTitleFromKebab(name)}`,
          navigate: {
            name: "See all tutorials",
            path: "/tutorials",
          },
        },
      },
      sidebar: {
        name: "Tutorials",
        props: async () => ({ tutorials: await getAllTutorials() }),
      },
    });
  }

  // Only allow integers for page names
  //
  // TODO: Allow custom names for pages e.g. `my-tutorial/my-page`
  if (page && !PgCommon.isInt(page)) {
    PgTutorial.openAboutPage();
    return;
  }

  // Only change the page if the tutorial is already in view
  if (!isTutorialInView) {
    isTutorialInView = true;

    // Set main view
    PgView.setMainPrimary(async () => {
      // Initialize explorer
      await PgExplorer.init({ name: tutorial.name });

      // Wait until `PgTutorial.current` gets set before refreshing the data to
      // avoid state corruption
      await PgCommon.tryUntilSuccess(async () => {
        if (PgTutorial.current?.name !== tutorial.name) throw new Error();
      }, 1);

      // Refresh tutorial state
      await PgTutorial.refresh();

      // A tutorial the fork has given a lesson path gets Flow's own
      // chrome instead: steps in the rail, the objective above the
      // editor, the page in a reader. Upstream's component would put
      // its markdown pane on the same edge as the assistant. Every
      // other tutorial takes the branch below, unchanged.
      // The barrel, not `./registry` -- importing it is what registers
      // the paths, and this route can run before Flow has mounted.
      // Whether a lesson path exists is all this one-shot callback
      // decides -- it is fixed for the life of the tutorial. Whether the
      // tutorial is *started* changes within the same routed session
      // (Start runs inside upstream's own component, well after this
      // callback has already returned), so `LessonRoute` makes that half
      // of the decision itself, reactively. See its own comment.
      const { getLessonPath } = await import("../../views/flow/lessons");
      if (getLessonPath(tutorial.name)) {
        const { default: LessonRoute } = await import(
          "../../views/flow/lessons/LessonRoute"
        );
        return <LessonRoute tutorial={tutorial} />;
      }

      const { default: Tutorial } = await tutorial.importComponent();
      return <Tutorial {...tutorial} />;
    });

    disposables.push(
      // Handle sidebar page changes
      PgView.onDidChangeCurrentSidebarPage(
        (p) => {
          if (!p) return;
          if (p.name === ownSidebarChange) {
            ownSidebarChange = undefined;
            return;
          }

          // Skip handling other routed pages in order to avoid navigation issues.
          // Without this check, this callback runs again after clicking to a
          // different sidebar page with route (e.g. Programs), which then
          // results in `PgTutorial.open` getting run and the user getting
          // navigated to the last tutorial's path erroneously.
          //
          // TODO: Find a way to dispose this *just before* the next navigation
          // and remove this check
          if (p.route && p.name !== "Tutorials") return;

          // The property this listener is derived from is recomputed
          // asynchronously (debounced) off of `sidebar.name`'s own change
          // event. When `sidebar.name` changes twice in quick succession --
          // e.g. the default-sidebar-page assignment in `routes/common.tsx`
          // landing late, right as this route synchronously sets it to
          // "Tutorials" -- the *earlier* change's callback can still fire
          // after the later one, delivering a stale `p` here that no longer
          // matches the live sidebar page. Ignore it; the live value's own
          // (correct) dispatch follows right behind.
          if (p.name !== PgView.sidebar.name) return;

          // `setMainPrimary`'s callback is async, so `PgTutorial.refresh()`
          // may not have resolved when the synchronous sidebar-name
          // assignment below fires this listener. Both branches read
          // tutorial state that does not exist yet at that moment:
          // `openAboutPage()` throws, and the `isStarted` branch navigates
          // away mid-open. Wait for the next change instead.
          if (!PgTutorial.current) return;

          if (p.name === "Tutorials") PgTutorial.openAboutPage();
          else if (!PgTutorial.isStarted(tutorial.name)) PgRouter.navigate();
          else PgTutorial.open(tutorial.name);
        },
        { skipInitialRunIfSameValue: true }
      ),

      // Handle workspace switch
      PgExplorer.onDidSwitchWorkspace(() => {
        const name = PgExplorer.currentWorkspaceName;
        if (!name || name === tutorial.name) return;

        if (PgTutorial.isWorkspaceTutorial(name)) PgTutorial.open(name);
        else PgRouter.navigate();
      }),

      // Handle workspace deletion
      PgExplorer.onDidDeleteWorkspace(() => {
        // Only handle if there are no more workspaces because
        // `onDidSwitchWorkspace` handles all other cases
        if (PgExplorer.allWorkspaceNames?.length === 0) PgRouter.navigate();
      }),

      // No listener since Flow replaced the classic layout; see below
      { dispose: () => PgView.setMainSecondaryHeight(mainSecondaryHeight) },

      // Set `isTutorialInView` to its default value
      { dispose: () => (isTutorialInView = false) },

      // Drop a pending own sidebar change the listener never saw
      { dispose: () => (ownSidebarChange = undefined) }
    );
  }

  // Open the correct sidebar page
  if (!page) {
    PgView.sidebar.name = "Tutorials";
    PgView.sidebar.props = async () => ({
      tutorials: await getAllTutorials(),
      pageName: PgView.sidebar.name,
    });
    disposables.push({ dispose: () => (PgView.sidebar.props = {}) });
  } else if (!PgView.sidebar.name || PgView.sidebar.name === "Tutorials") {
    ownSidebarChange = "Explorer";
    PgView.sidebar.name = "Explorer";
  } else {
    PgView.sidebar.props = {};
  }

  // Asked the classic layout to minimize its secondary view; nothing listens
  // since Flow replaced it (see `PgView.setMainSecondaryHeight`)
  PgView.setMainSecondaryHeight((h) => {
    if (page) {
      if (h > PgView.getMainSecondaryMinHeight()) mainSecondaryHeight = h;
      return mainSecondaryHeight;
    }
    return 0;
  });

  return {
    dispose: () => {
      // If the new path is still the same tutorial, return early without
      // disposing anything
      try {
        const newParams = PgRouter.getParamsFromPath(
          tutorials.path,
          PgRouter.location.pathname
        );
        if (newParams.name === name) return;
      } catch {}

      // Dispose all disposables and clear it
      disposables.forEach(({ dispose }) => dispose());
      disposables = [];
    },
  };
};

const getAllTutorials = async (): Promise<TutorialFullData[]> => {
  await PgCommon.tryUntilSuccess(() => {
    if (!PgExplorer.isInitialized) throw new Error();
  }, 10);

  return await Promise.all(
    PgTutorial.all.map(async (t) => {
      const tutorial: Partial<TutorialFullData> = { ...t };
      if (PgTutorial.isStarted(t.name)) {
        // Use the up-to-date state data for the current tutorial because there
        // is a slight delay before tutorial metadata gets saved to storage.
        //
        // TODO: Make sure this function runs again after tutorial metadata gets
        // saved to storage and remove this workaround.
        const metadata =
          t.name === PgTutorial.current?.name &&
          typeof PgTutorial.completed === "boolean" &&
          typeof PgTutorial.pageNumber === "number"
            ? {
                completed: PgTutorial.completed,
                pageNumber: PgTutorial.pageNumber,
              }
            : await PgTutorial.getMetadata(t.name);
        tutorial.metadata = metadata;
        tutorial.progress = metadata.completed ? "Completed" : "Ongoing";
      } else {
        tutorial.progress = "Not started";
      }

      return tutorial as TutorialFullData;
    })
  );
};
