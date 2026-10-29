import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";

// The hook subscribes to none of these: the explorer stands in so that a
// subscription added back fails "stays open through the explorer's own
// switches and creates"
const explorer = vi.hoisted(() => ({
  created: [] as Array<() => void>,
  switched: [] as Array<() => void>,
  onDidCreateWorkspace: vi.fn(),
  onDidSwitchWorkspace: vi.fn(),
}));
const router = vi.hoisted(() => ({
  changed: [] as Array<(path: string) => void>,
  onDidChangePath: vi.fn(),
}));
vi.mock("@/utils", () => ({ PgExplorer: explorer, PgRouter: router }));

import { catalogPage, useCatalogPage } from "./catalog-page";

const sub =
  <T>(list: T[]) =>
  (cb: T) => {
    list.push(cb);
    return { dispose: () => list.splice(list.indexOf(cb), 1) };
  };

let sent: ReturnType<typeof memoryProvider>;
beforeEach(() => {
  explorer.created = [];
  explorer.switched = [];
  explorer.onDidCreateWorkspace.mockImplementation(sub(explorer.created));
  explorer.onDidSwitchWorkspace.mockImplementation(sub(explorer.switched));
  router.changed = [];
  router.onDidChangePath.mockImplementation(sub(router.changed));
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
});
afterEach(() => {
  // A rendered hook is still mounted here: RTL's own cleanup runs after this hook
  act(() => catalogPage.close());
  resetTelemetry();
});

it("opens a page and reports it once", () => {
  catalogPage.open("programs", "nav");
  catalogPage.open("programs", "nav");

  expect(catalogPage.current()).toBe("programs");
  expect(sent.events).toEqual([
    { name: "catalog_shown", params: { page: "programs", via: "nav" } },
  ]);
});

it("reports a switch from one page to the other", () => {
  catalogPage.open("programs", "nav");
  catalogPage.open("tutorials", "home");

  expect(sent.events.map((e) => e.params)).toEqual([
    { page: "programs", via: "nav" },
    { page: "tutorials", via: "home" },
  ]);
});

it("tells its listeners when the page closes", () => {
  const seen: Array<string | null> = [];
  const sub = catalogPage.onDidChange((page) => seen.push(page));
  catalogPage.open("tutorials", "nav");
  catalogPage.close();
  sub.dispose();
  catalogPage.open("programs", "nav");

  expect(seen).toEqual(["tutorials", null]);
  expect(catalogPage.current()).toBe("programs");
});

it("renders the page open and follows it", () => {
  const { result } = renderHook(() => useCatalogPage());
  expect(result.current).toBeNull();

  act(() => catalogPage.open("tutorials", "nav"));
  expect(result.current).toBe("tutorials");
});

// The explorer switches to the current project on every route's init, and
// sync switches and creates projects in the background: none of those is the
// user leaving the page
it("stays open through the explorer's own switches and creates", () => {
  renderHook(() => useCatalogPage());
  act(() => catalogPage.open("tutorials", "link"));

  act(() => explorer.switched.forEach((cb) => cb()));
  act(() => explorer.created.forEach((cb) => cb()));
  expect(catalogPage.current()).toBe("tutorials");
});

it("closes when a tutorial's route opens, not on the start route", () => {
  renderHook(() => useCatalogPage());
  act(() => catalogPage.open("tutorials", "link"));

  act(() => router.changed.forEach((cb) => cb("/")));
  expect(catalogPage.current()).toBe("tutorials");

  act(() => router.changed.forEach((cb) => cb("/tutorials/hello-anchor")));
  expect(catalogPage.current()).toBeNull();
});

it("stops listening once unmounted", () => {
  const { unmount } = renderHook(() => useCatalogPage());
  unmount();

  expect(router.changed).toEqual([]);
});
