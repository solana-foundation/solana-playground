import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  initLogger,
  memoryProvider as memoryLogs,
  resetLogger,
} from "@/shared/lib/logger";

const router = vi.hoisted(() => ({
  location: { pathname: "/" },
  changed: [] as Array<(path: string) => void>,
  navigate: vi.fn(),
  onDidChangePath: vi.fn(),
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

import type { ShownPage } from "@/widgets/catalog";
import type { StartView } from "@/widgets/home";

import { useViewPath } from "./use-view-path";

type Props = { view: StartView; catalog: ShownPage | undefined };

const at = (path: string) => {
  router.location.pathname = path;
};
/** The path changes the way the router announces it: Back, Forward, a route */
const arrive = (path: string) => {
  at(path);
  router.changed.forEach((cb) => cb(path));
};
const mount = (props: Props) =>
  renderHook((p: Props) => useViewPath(p), { initialProps: props });

let logged: ReturnType<typeof memoryLogs>;
beforeEach(() => {
  logged = memoryLogs();
  initLogger({ providers: [logged] });
  at("/");
  router.changed = [];
  router.navigate.mockReset().mockResolvedValue(undefined);
  // As `PgRouter.onDidChangePath` does: the current path at once, then each
  router.onDidChangePath.mockReset().mockImplementation((cb) => {
    router.changed.push(cb);
    cb(router.location.pathname);
    return { dispose: () => {} };
  });
  explorer.currentWorkspaceName = "work";
  explorer.isTemporary = false;
  tutorial.isWorkspaceTutorial.mockReset().mockReturnValue(false);
  tutorial.open.mockReset().mockResolvedValue(undefined);
  catalog.catalogPage.open.mockReset();
  catalog.catalogPage.close.mockReset();
});

afterEach(() => resetLogger());

describe("a path come to", () => {
  it.each([
    ["/new", "new-project"],
    ["/tutorials", "tutorials"],
    ["/programs/", "programs"],
  ] as const)("%s opens the page %s", (path, page) => {
    mount({ view: "work", catalog: undefined });
    arrive(path);
    expect(catalog.catalogPage.open).toHaveBeenCalledWith(page, "link");
  });

  it("anything else closes the page shown", () => {
    at("/tutorials");
    mount({ view: "work", catalog: "tutorials" });
    arrive("/tutorials/hello-anchor/1");
    expect(catalog.catalogPage.close).toHaveBeenCalledTimes(1);
  });
});

describe("a page the user opens", () => {
  it.each([
    ["new-project", "/new"],
    ["tutorials", "/tutorials"],
    ["programs", "/programs"],
  ] as const)("%s pushes its own path, %s", (page, path) => {
    const hook = mount({ view: "work", catalog: undefined });
    hook.rerender({ view: "work", catalog: page });
    expect(router.navigate).toHaveBeenCalledWith(path);
  });

  it("is pushed once, though the router announces the path it pushed", () => {
    router.navigate.mockImplementation(async (path: string) => arrive(path));
    const hook = mount({ view: "work", catalog: undefined });
    hook.rerender({ view: "work", catalog: "tutorials" });
    hook.rerender({ view: "work", catalog: "tutorials" });
    expect(router.navigate).toHaveBeenCalledTimes(1);
    expect(catalog.catalogPage.close).not.toHaveBeenCalledAfter(
      catalog.catalogPage.open
    );
  });

  it("reports a path it could not push", async () => {
    router.navigate.mockRejectedValue(new Error("no router"));
    const hook = mount({ view: "work", catalog: undefined });
    hook.rerender({ view: "work", catalog: "programs" });
    await waitFor(() => expect(logged.entries).toHaveLength(1));
    expect(logged.entries[0].ns).toBe("flow:view-path");
    expect(logged.entries[0].report).toBe(true);
  });

  it("is not pushed again when it shows on its own path", () => {
    at("/programs/");
    mount({ view: "work", catalog: "programs" });
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it("leaves a shared project's path alone", () => {
    at("/open");
    explorer.isTemporary = true;
    const hook = mount({ view: "work", catalog: undefined });
    hook.rerender({ view: "work", catalog: "tutorials" });
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it("waits for the start to be decided", () => {
    const hook = mount({ view: "pending", catalog: undefined });
    hook.rerender({ view: "pending", catalog: "tutorials" });
    expect(router.navigate).not.toHaveBeenCalled();
  });
});

describe("a page that closes on its own path", () => {
  it("goes back to the project on `/`", () => {
    at("/tutorials");
    const hook = mount({ view: "work", catalog: "tutorials" });
    hook.rerender({ view: "work", catalog: undefined });
    expect(router.navigate).toHaveBeenCalledWith("/");
  });

  it("goes back to a tutorial's own route", () => {
    tutorial.isWorkspaceTutorial.mockReturnValue(true);
    explorer.currentWorkspaceName = "Hello Anchor";
    at("/programs");
    const hook = mount({ view: "work", catalog: "programs" });
    hook.rerender({ view: "work", catalog: undefined });
    expect(tutorial.open).toHaveBeenCalledWith("Hello Anchor");
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it("goes back to the path Home showed on", () => {
    at("/tutorials/hello-anchor/1");
    const hook = mount({ view: "home", catalog: undefined });
    hook.rerender({ view: "home", catalog: "new-project" });
    at("/new");
    hook.rerender({ view: "home", catalog: undefined });
    expect(router.navigate).toHaveBeenLastCalledWith(
      "/tutorials/hello-anchor/1"
    );
  });

  it("leaves a shared project's path alone", () => {
    explorer.isTemporary = true;
    at("/tutorials");
    const hook = mount({ view: "work", catalog: "tutorials" });
    hook.rerender({ view: "work", catalog: undefined });
    expect(router.navigate).not.toHaveBeenCalled();
    expect(tutorial.open).not.toHaveBeenCalled();
  });

  it("moves nothing with no project open: Home stands in on any start path", () => {
    explorer.currentWorkspaceName = undefined;
    at("/new");
    const hook = mount({ view: "work", catalog: "new-project" });
    hook.rerender({ view: "work", catalog: undefined });
    expect(router.navigate).not.toHaveBeenCalled();
  });
});

describe("a page that closes off its own path", () => {
  it("leaves the path its pick went to", () => {
    at("/tutorials");
    const hook = mount({ view: "work", catalog: "tutorials" });
    // A card's Open: the tutorial's route moved the path, then the page closed
    at("/tutorials/hello-anchor/1");
    hook.rerender({ view: "work", catalog: undefined });
    expect(router.navigate).not.toHaveBeenCalled();
    expect(tutorial.open).not.toHaveBeenCalled();
  });
});
