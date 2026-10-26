import { expect, home, homeRegion, startProject, test } from "./fixtures";

import { openGallery } from "./fixtures";

/**
 * D16: opening a tutorial that has never been started, while a real
 * project is the active workspace, used to throw
 * `Current tutorial has not been set` or bounce back to `/`. An
 * already-started tutorial always worked, so the regression only shows
 * on a first open.
 */
test("opens an unstarted tutorial from an active project", async ({ page }) => {
  // Booting the dev server, creating a project and importing a tutorial
  // is well past the 30s default.
  test.setTimeout(120_000);

  await page.goto("/");

  // Make a real project the active workspace first -- D16 only shows up
  // when a project is already active, not on the very first, empty-state
  // open (Home's New project tile unfolds `StartFromScratch`).
  await startProject(page, "d16-project");

  // The gallery as a dialog named by its title, for the steps below.
  const gallery = page.getByRole("dialog", {
    name: "What do you want to build?",
  });

  // Reopen the gallery from the navigation now that a project is active
  await openGallery(page);
  await expect(gallery).toBeVisible();

  await gallery.getByRole("radio", { name: /^Tutorials/ }).click();
  await gallery.getByRole("button", { name: "Open Hello Anchor" }).click();

  // The tutorial's own editor must appear, and the app must not have
  // fallen back to the home route.
  await expect(page).toHaveURL(/\/tutorials\/hello-anchor/);
  await expect(page.getByText("Current tutorial has not been set")).toHaveCount(
    0
  );
});

/**
 * The path this covers: `views/flow/lessons/paths/hello-anchor.ts`. Its
 * step 1 (`write-program`) has no attempt recorded and no page verified,
 * so the rail still names it "build to prove this" and the assistant action
 * is at rung zero.
 */
test("a lesson step is finished by the toolchain, not by a click", async ({
  page,
}) => {
  // Opening the gallery, opening a tutorial and letting the assistant
  // panel mount are each their own async settle; well past the 30s
  // default.
  test.setTimeout(120_000);

  // No default backend, so the ask below has no model to go to whatever the
  // dev server is configured with
  await page.route("**/api/agent", (route) =>
    route.fulfill({ json: { configured: false, model: null } })
  );
  await page.goto("/");

  // Home's tutorial cards: only the "Open <name>" button has a click handler;
  // the title text itself does not.
  await expect(home(page)).toBeVisible();
  await homeRegion(page)
    .getByRole("button", { name: "Open Hello Anchor" })
    .click();
  await expect(home(page)).toBeHidden();

  // Open lands on upstream's own About/Start screen for a lesson tutorial
  // that has never been started -- Start is what creates the workspace
  // (`PgTutorial.start()` -> `PgExplorer.createWorkspace()`) and is what
  // flips `LessonRoute` over to the lesson chrome. `exact` keeps the
  // locator off any other name holding "Start", such as Connect a model's
  // own Start while that dialog is open.
  await page.getByRole("button", { name: "Start", exact: true }).click();

  // The rail switches to the lesson's steps, and the band names step 1.
  // `hello-anchor.ts` has four steps, so this is also a count check.
  //
  // This, and everything up to the "build to prove this" assertion below, is
  // Flow's own outer chrome -- it mounts regardless of whether the main
  // surface underneath is `LessonSurface` or upstream's own `Tutorial`,
  // so none of it actually guards the bug two commits back in this
  // branch (`LessonRoute` picking the wrong surface after Start). The
  // assertion right after this block is the one that does: see its own
  // comment.
  await expect(page.getByRole("radio", { name: "Steps" })).toBeVisible();
  // The band is the design system's objective band; scope to it so the
  // objective is one element (the rail and the reader repeat the text).
  const band = page.locator('[data-slot="objective-band"]');
  await expect(band.getByText("Step 1 of 4", { exact: true })).toBeVisible();
  await expect(
    band.getByText("Define the hello instruction and log a message")
  ).toBeVisible();

  // Nothing has been verified yet, so the rail still names what the
  // current step is aiming at rather than marking it done. `exact` and
  // the case matter: the band's primary is "Build to prove this".
  await expect(
    page.getByText("build to prove this", { exact: true })
  ).toBeVisible();

  // The one assertion in this test that actually guards the Start-time
  // bug: the main surface has to be `LessonSurface` (editor alone), not
  // upstream's `Tutorial` rendering its own `Main` (editor plus markdown
  // pane) beside it. Every assertion above this line passes either way,
  // since Flow's outer chrome (rail, band) reacts to the workspace
  // independently of which component is mounted in the main area -- this
  // is what let the bug ship past three manual checks in this plan.
  //
  // "Next" is `components/Tutorial/views/Main.tsx`'s own hardcoded label
  // above its page-navigation button (`NextText`), present on every page
  // but the last regardless of which tutorial is open -- structural, not
  // this tutorial's prose, so it stays true if the wording of Hello
  // Anchor's own pages ever changes. `LessonSurface` renders nothing but
  // `EditorWithTabs`, so if `Main` is what is actually mounted, "Next"
  // is on the page; if `LessonSurface` is mounted, it is not.
  await expect(page.getByText("Next", { exact: true })).toHaveCount(0);

  // Entering the lesson lands on its page (D34): the sheet is open with
  // no click, its footer names the way on, and closing it leaves the
  // band pointing at the code with the plain label -- the record now
  // knows the page was opened, so the "read first" signpost has rested.
  await expect(
    page.getByRole("dialog", { name: /hello instruction/i })
  ).toBeVisible();
  await expect(page.getByText("Back to the code")).toBeVisible();
  // The record learns `opened` only once the page content actually
  // loads, so wait for the band's signpost (visible beside the sheet) to
  // rest before closing -- an Escape that outruns the load leaves the
  // page unread on purpose.
  await expect(
    page.getByRole("button", { name: "Read the page" })
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: /hello instruction/i })
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Read the page" })
  ).toBeVisible();

  // The first ask opens the door rather than answering outright. The e2e
  // has no connected model, so there is no transcript to assert on --
  // the prompt text itself is covered by the in-source tests of `hints.ts`. What is
  // deterministic here is the band's own action label: rung zero reads
  // "I'm stuck"; one click with no attempt yet recorded moves it to
  // "Try it first" (`band-copy.ts`'s `assistantLabel`). With nothing to
  // send the hint to, the ask opens Connect a model over the page; closed,
  // the band is back with its new label.
  await expect(page.getByRole("button", { name: "I'm stuck" })).toBeVisible();
  await page.getByRole("button", { name: "I'm stuck" }).click();
  const connect = page.getByRole("dialog", { name: "Connect a model" });
  await expect(connect).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(connect).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Try it first" })
  ).toBeVisible();

  // Skipping to the read step: its page has never been opened, so the
  // band signposts it, and the reader's footer offers the step's own
  // edge -- "Mark as read" -- where the reading ends. The band offers
  // the same label, so scope to the sheet.
  const skip = page.getByRole("button", {
    name: "Skip this step",
    exact: true,
  });
  await skip.click();
  await expect(
    page.getByRole("button", { name: "Read step 2 first" })
  ).toBeVisible();

  // The deploy step explains what it still needs rather than failing: on
  // a fresh profile there is no build and no wallet, and the band names
  // both, each as a live remedy (`lessons/readiness.ts`). The primary
  // stays offered either way.
  await expect(page.getByText("Before you can deploy:")).toBeVisible();
  await expect(page.getByRole("button", { name: "build first" })).toBeVisible();
  // `exact`: the navigation's Get set up checklist has a "Connect a wallet"
  // step too
  await expect(
    page.getByRole("button", { name: "connect a wallet", exact: true })
  ).toBeVisible();
  // ...and says nothing about the cluster, because the profile is already
  // on devnet. Blaming a cluster that is right -- or one the client has
  // not resolved yet -- is worse than saying nothing at all.
  await expect(page.getByText(/switch .*to devnet/)).toHaveCount(0);
  // `exact`: the rail's row for the step is a button whose text also
  // ends in "deploy to prove this"
  await expect(
    page.getByRole("button", { name: "Deploy to prove this", exact: true })
  ).toBeVisible();

  await skip.click();
  await page.getByRole("button", { name: "Read step 3 first" }).click();
  const sheet = page.getByRole("dialog", { name: /TypeScript client/i });
  await expect(
    sheet.getByRole("button", { name: "Mark as read", exact: true })
  ).toBeVisible();
  await expect(sheet.getByText("Back to the code")).toHaveCount(0);

  // The footer's edge actually fires: the step attests, the sheet
  // closes, and the cursor walks on. A dead or mis-wired `onAttest`
  // fails here, not at the visibility check above.
  await sheet
    .getByRole("button", { name: "Mark as read", exact: true })
    .click();
  await expect(sheet).toHaveCount(0);
  await expect(
    page.getByText("Step 4 of 4", { exact: true }).first()
  ).toBeVisible();

  // Skipping the last step lands past the end: the band sums the path in
  // the record's own vocabulary and offers the gallery as the way on,
  // with the back arrow still live for the repair edge.
  await skip.click();
  await expect(page.getByText("You have finished Hello Anchor.")).toBeVisible();
  await expect(
    page.getByText("1 marked read, 3 skipped -- go back to prove it.")
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Browse gallery" })
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Previous step" })
  ).toBeEnabled();
});
