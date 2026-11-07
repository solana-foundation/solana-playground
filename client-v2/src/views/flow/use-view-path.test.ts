import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

const router = vi.hoisted(() => ({
  location: { pathname: "/" },
  changed: [] as Array<(path: string) => void>,
  onDidChangePath: vi.fn(),
  navigate: vi.fn(),
}));
const explorer = vi.hoisted(() => ({
  currentWorkspaceName: undefined as string | undefined,
  isTemporary: false,
}));
const tutorial = vi.hoisted(() => ({
  isWorkspaceTutorial: vi.fn(),
  open: vi.fn(),
}));
vi.mock("@/utils", () => ({
  PgExplorer: explorer,
  PgRouter: router,
  PgTutorial: tutorial,
}));
const catalog = vi.hoisted(() => ({
  catalogPage: { open: vi.fn(), close: vi.fn() },
}));
vi.mock("@/widgets/catalog", () => catalog);

import type { CatalogPage } from "@/widgets/catalog";
import type { HomeVia, StartView } from "@/widgets/home";

import { useViewPath } from "./use-view-path";

type Shown = {
  view: StartView;
  homeVia?: HomeVia;
  catalog?: CatalogPage;
};
const render = (initial: Shown) =>
  renderHook(
    (p: Shown) =>
      useViewPath({
        view: p.view,
        homeVia: p.homeVia,
        catalog: p.catalog,
      }),
    { initialProps: initial }
  );

/** Where the hook moved the address bar to, and how */
const moves = () => router.navigate.mock.calls;

beforeEach(() => {
  router.location.pathname = "/";
  router.changed = [];
  router.onDidChangePath.mockReset().mockImplementation((cb) => {
    router.changed.push(cb);
    cb(router.location.pathname);
    return {
      dispose: () => router.changed.splice(router.changed.indexOf(cb), 1),
    };
  });
  router.navigate.mockReset().mockResolvedValue(undefined);
  explorer.currentWorkspaceName = undefined;
  explorer.isTemporary = false;
  tutorial.isWorkspaceTutorial.mockReset().mockReturnValue(false);
  tutorial.open.mockReset().mockResolvedValue(undefined);
  catalog.catalogPage.open.mockReset();
  catalog.catalogPage.close.mockReset();
});

it("puts Home picked from a tutorial on Home's own path, as a new entry", () => {
  router.location.pathname = "/tutorials/lumberjack/3";
  const { rerender } = render({ view: "work" });
  expect(moves()).toEqual([]);

  rerender({ view: "home", homeVia: "nav" });
  expect(moves()).toEqual([["/home"]]);
});

it("leaves Home that shows on `/` by itself there", () => {
  const { rerender } = render({ view: "home", homeVia: "start" });
  expect(moves()).toEqual([]);
  // Sync opens the account's newest project, a lesson: `/` stays the work's
  explorer.currentWorkspaceName = "Lumberjack";
  tutorial.isWorkspaceTutorial.mockReturnValue(true);
  rerender({ view: "work" });
  expect(moves()).toEqual([]);
  expect(tutorial.open).not.toHaveBeenCalled();
});

it("goes back to `/` when a page over Home there by itself closes", () => {
  const { rerender } = render({ view: "home", homeVia: "last-deleted" });
  router.location.pathname = "/programs";
  rerender({ view: "home", homeVia: "last-deleted", catalog: "programs" });
  rerender({ view: "home", homeVia: "last-deleted", catalog: undefined });
  expect(moves()).toEqual([["/"]]);
});

it("takes the work to its own path when Home was picked, not `/`", () => {
  router.location.pathname = "/";
  explorer.currentWorkspaceName = "Lumberjack";
  tutorial.isWorkspaceTutorial.mockReturnValue(true);
  const { rerender } = render({ view: "home", homeVia: "start" });
  rerender({ view: "work" });
  // The navigation's Home over the work, then the work again
  rerender({ view: "home", homeVia: "nav" });
  expect(moves()).toEqual([["/home"]]);
  router.location.pathname = "/home";
  rerender({ view: "work" });
  expect(tutorial.open).toHaveBeenCalledWith("Lumberjack");
});

it("keeps `/` as an entry when Home is picked over a project there", () => {
  const { rerender } = render({ view: "work" });
  rerender({ view: "home", homeVia: "nav" });
  expect(moves()).toEqual([["/home"]]);
});

it("does nothing while the start is pending, or on the path already shown", () => {
  render({ view: "pending" });
  router.location.pathname = "/home";
  render({ view: "home", homeVia: "back" });
  router.location.pathname = "/tutorials";
  render({ view: "home", homeVia: "nav", catalog: "tutorials" });
  expect(moves()).toEqual([]);
});

it("gives a page its own path, over Home or the work", () => {
  router.location.pathname = "/home";
  const { rerender } = render({ view: "home", homeVia: "nav" });
  rerender({ view: "home", homeVia: "nav", catalog: "programs" });
  expect(moves()).toEqual([["/programs"]]);
});

it("goes back to Home's path when a page over Home closes", () => {
  router.location.pathname = "/tutorials";
  const { rerender } = render({
    view: "home",
    homeVia: "nav",
    catalog: "tutorials",
  });
  rerender({ view: "home", homeVia: "nav", catalog: undefined });
  expect(moves()).toEqual([["/home"]]);
});

it("leaves Home for a tutorial's own route, its saved page with it", () => {
  router.location.pathname = "/home";
  explorer.currentWorkspaceName = "Lumberjack";
  tutorial.isWorkspaceTutorial.mockReturnValue(true);
  const { rerender } = render({ view: "home", homeVia: "nav" });

  rerender({ view: "work" });
  expect(tutorial.open).toHaveBeenCalledWith("Lumberjack");
  expect(moves()).toEqual([]);
});

it("leaves Home or a page for `/` with any other project", () => {
  router.location.pathname = "/programs";
  explorer.currentWorkspaceName = "counter";
  const { rerender } = render({ view: "work", catalog: "programs" });

  rerender({ view: "work", catalog: undefined });
  expect(moves()).toEqual([["/"]]);
  expect(tutorial.open).not.toHaveBeenCalled();
});

it("leaves the work on a route alone", () => {
  router.location.pathname = "/tutorials/lumberjack/2";
  const { rerender } = render({ view: "home", homeVia: "nav" });
  router.navigate.mockClear();
  rerender({ view: "work" });
  expect(moves()).toEqual([]);
  expect(tutorial.open).not.toHaveBeenCalled();
});

it("leaves the path a pick already moved when the page closes after it", () => {
  router.location.pathname = "/programs";
  explorer.currentWorkspaceName = "counter";
  const { rerender } = render({
    view: "home",
    homeVia: "nav",
    catalog: "programs",
  });
  router.location.pathname = "/tutorials/lumberjack/1";
  rerender({ view: "home", homeVia: "nav", catalog: undefined });
  expect(moves()).toEqual([]);
  expect(tutorial.open).not.toHaveBeenCalled();
});

it("keeps Home off a route Back has gone to, until Home leaves", () => {
  router.location.pathname = "/home";
  const { rerender } = render({ view: "home", homeVia: "nav" });
  router.location.pathname = "/tutorials/lumberjack/2";
  rerender({ view: "home", homeVia: "back" });
  expect(moves()).toEqual([]);
});

it("moves no path over a shared project, which lives only on its own", () => {
  router.location.pathname = "/open";
  explorer.isTemporary = true;
  const { rerender } = render({ view: "work" });
  rerender({ view: "home", homeVia: "nav" });
  rerender({ view: "home", homeVia: "nav", catalog: "tutorials" });
  rerender({ view: "work", catalog: undefined });
  expect(moves()).toEqual([]);
});

it("leaves the start's fallback work where it is with no project open", () => {
  router.location.pathname = "/home";
  render({ view: "work" });
  expect(moves()).toEqual([]);
  expect(tutorial.open).not.toHaveBeenCalled();
});

it("opens and closes a page on the path come to", () => {
  render({ view: "work" });
  catalog.catalogPage.close.mockClear();

  act(() => router.changed.forEach((cb) => cb("/tutorials")));
  expect(catalog.catalogPage.open).toHaveBeenCalledWith("tutorials", "link");

  act(() => router.changed.forEach((cb) => cb("/tutorials/hello-anchor/1")));
  expect(catalog.catalogPage.close).toHaveBeenCalledTimes(1);
});

it("stops listening once unmounted", () => {
  const { unmount } = render({ view: "work" });
  unmount();
  expect(router.changed).toEqual([]);
});
