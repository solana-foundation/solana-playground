import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  initLogger,
  memoryProvider as memoryLogs,
  resetLogger,
} from "@/shared/lib/logger";
import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";

const utils = vi.hoisted(() => ({
  PgTutorial: { all: [] as unknown[], open: vi.fn() },
}));
vi.mock("@/utils", () => utils);

/** Each tutorial's progress by name; new when absent */
const progress = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/entities/tutorial", async () => {
  const actual = await vi.importActual<typeof import("@/entities/tutorial")>(
    "@/entities/tutorial"
  );
  return {
    startTutorials: actual.startTutorials,
    ladderLine: actual.ladderLine,
    TutorialCover: (await import("@/entities/tutorial/ui/art/TutorialCover"))
      .default,
    useTutorialProgress: () => (name: string) =>
      progress.get(name) ?? { state: "new" },
  };
});

import { catalogPage } from "../model/catalog-page";
import TutorialsPage from "./TutorialsPage";

const tutorial = (
  name: string,
  level: string,
  framework: string,
  description: string
  // eslint-disable-next-line max-params -- tutorial flow v2 predates this rule; cleanup tracked from SF#94
) => ({
  name,
  description,
  level,
  framework,
  authors: [{ name: "acheron" }],
  pageCount: 4,
  thumbnail: `/${name}.png`,
});

/** Hello Anchor as its definition lists it: four steps */
const helloAnchor = () => ({
  name: "Hello Anchor",
  description: "Hello world with Anchor",
  level: "Beginner",
  framework: "Anchor",
  authors: [{ name: "acheron" }],
  pageCount: 4,
  thumbnail: "/hello-anchor.png",
  definition: {
    minutes: 10,
    steps: [
      { objective: "Write it" },
      { objective: "Deploy it" },
      { objective: "Call it" },
      { objective: "Name it" },
    ],
    finish: { headline: "You built and called your first Solana program." },
  },
});

let sent: ReturnType<typeof memoryProvider>;
let logged: ReturnType<typeof memoryLogs>;
beforeEach(() => {
  utils.PgTutorial.all = [
    tutorial("Hello Seahorse", "Beginner", "Seahorse", "Hello with Seahorse"),
    tutorial("Zero Copy", "Advanced", "Anchor", "Big accounts"),
    tutorial("Lumberjack", "Intermediate", "Anchor", "An energy system"),
    helloAnchor(),
  ];
  progress.clear();
  utils.PgTutorial.open.mockReset().mockResolvedValue(undefined);
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
  logged = memoryLogs();
  initLogger({ providers: [logged] });
});
afterEach(() => {
  catalogPage.close();
  vi.useRealTimers();
  resetTelemetry();
  resetLogger();
});

const search = (value: string) =>
  fireEvent.change(
    screen.getByRole("searchbox", { name: "Search tutorials" }),
    {
      target: { value },
    }
  );
const named = (name: string) => sent.events.filter((e) => e.name === name);
// The progress read begun on mount lands on a microtask, after a sync test ends
const draw = async () => {
  render(<TutorialsPage />);
  await act(async () => {});
};

it("finds a tutorial by search", async () => {
  await draw();
  search("energy");

  expect(
    screen.queryByRole("button", { name: "Open Hello Anchor" })
  ).toBeNull();
  expect(screen.getByRole("button", { name: "Open Lumberjack" })).toBeTruthy();
});

it("opens a tutorial, reports it and leaves the page", async () => {
  // Opening the lesson already open changes no route, so the page closes
  // itself rather than waiting on one
  catalogPage.open("tutorials", "nav");
  render(<TutorialsPage />);
  fireEvent.click(screen.getByRole("button", { name: "Open Lumberjack" }));

  await waitFor(() => expect(named("catalog_item_opened")).toHaveLength(1));
  expect(utils.PgTutorial.open).toHaveBeenCalledWith("Lumberjack");
  expect(named("catalog_item_opened")[0].params).toEqual({ page: "tutorials" });
  expect(catalogPage.current()).toBeNull();
});

it("refuses a second Open while one runs", async () => {
  utils.PgTutorial.open.mockReturnValue(new Promise<void>(() => {}));
  await draw();
  fireEvent.click(screen.getByRole("button", { name: "Open Hello Anchor" }));
  fireEvent.click(screen.getByRole("button", { name: "Open Lumberjack" }));

  expect(utils.PgTutorial.open).toHaveBeenCalledTimes(1);
});

it("shows a failed open on its card, reports and logs it, and stays", async () => {
  utils.PgTutorial.open.mockRejectedValue(new Error("Assets missing"));
  catalogPage.open("tutorials", "nav");
  render(<TutorialsPage />);
  fireEvent.click(screen.getByRole("button", { name: "Open Hello Anchor" }));

  expect((await screen.findByRole("alert")).textContent).toBe("Assets missing");
  expect(named("catalog_open_failed")[0].params).toEqual({ page: "tutorials" });
  expect(named("catalog_item_opened")).toEqual([]);
  expect(logged.entries.map((e) => [e.ns, e.report])).toEqual([
    ["catalog:open", true],
  ]);
  expect(catalogPage.current()).toBe("tutorials");
});

it("reports a search once typing rests", async () => {
  vi.useFakeTimers();
  await draw();
  search("z");
  act(() => vi.advanceTimersByTime(200));
  search("zz");
  act(() => vi.advanceTimersByTime(200));
  search("zzz");
  act(() => vi.advanceTimersByTime(500));

  expect(named("catalog_searched").map((e) => e.params)).toEqual([
    { page: "tutorials", empty: true },
  ]);
});

it("reports no search for a cleared field", async () => {
  vi.useFakeTimers();
  await draw();
  search("anchor");
  act(() => vi.advanceTimersByTime(100));
  search("");
  act(() => vi.advanceTimersByTime(1000));

  expect(named("catalog_searched")).toEqual([]);
});

it("lists only the start's three, by level, with no framework filter", () => {
  render(<TutorialsPage />);

  expect(
    screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)
  ).toEqual(["Hello Anchor", "Beginner", "Intermediate", "Advanced"]);
  expect(
    screen.queryByRole("button", { name: "Open Hello Seahorse" })
  ).toBeNull();
  expect(
    screen.getByRole("searchbox", { name: "Search tutorials" })
  ).toHaveProperty("placeholder", "Search 3 tutorials");
  expect(
    screen.queryByRole("button", { name: "Filter by framework" })
  ).toBeNull();
  expect(screen.queryByRole("button", { name: "Show all" })).toBeNull();
});

it("invites a first start of Hello Anchor and reports the banner's open", async () => {
  render(<TutorialsPage />);
  const banner = screen.getByRole("region", { name: "Hello Anchor" });
  expect(banner.textContent).toContain("Start here");
  expect(banner.textContent).toContain(
    "Write, deploy and call your first program"
  );
  fireEvent.click(screen.getByRole("button", { name: "Start" }));

  await waitFor(() => expect(named("catalog_banner_opened")).toHaveLength(1));
  expect(utils.PgTutorial.open).toHaveBeenCalledWith("Hello Anchor");
  expect(named("catalog_banner_opened")[0].params).toEqual({ state: "fresh" });
});

it("picks up Hello Anchor half done", () => {
  progress.set("Hello Anchor", { state: "started", page: 2, pages: 4 });
  render(<TutorialsPage />);

  const banner = screen.getByRole("region", { name: "Hello Anchor" });
  expect(banner.textContent).toContain("Continue · Step 3 of 4");
  expect(banner.textContent).toContain("Next: Call it");
  expect(
    screen
      .getByRole("button", { name: "Continue Hello Anchor" })
      .closest('[data-slot="action-card"]')?.textContent
  ).toContain("2 of 4");
});

it("counts pages on the card of a tutorial without a definition", () => {
  progress.set("Lumberjack", { state: "started", page: 2, pages: 4 });
  render(<TutorialsPage />);

  expect(
    screen
      .getByRole("button", { name: "Continue Lumberjack" })
      .closest('[data-slot="action-card"]')?.textContent
  ).toContain("2 of 4");
});

it("reports the banner's state when Continue opens it", async () => {
  progress.set("Hello Anchor", { state: "started", page: 1, pages: 4 });
  render(<TutorialsPage />);
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));

  await waitFor(() => expect(named("catalog_banner_opened")).toHaveLength(1));
  expect(named("catalog_banner_opened")[0].params).toEqual({
    state: "started",
  });
});

it("moves on to Lumberjack once Hello Anchor is done", () => {
  progress.set("Hello Anchor", { state: "completed" });
  render(<TutorialsPage />);

  expect(
    screen.getByRole("region", { name: "Lumberjack" }).textContent
  ).toContain("Start here");
  expect(
    screen.getByRole("button", { name: "Hello Anchor completed. Open it" })
  ).toBeTruthy();
});

it("says Completed with only Open again once all three are done", () => {
  for (const name of ["Hello Anchor", "Lumberjack", "Zero Copy"])
    progress.set(name, { state: "completed" });
  render(<TutorialsPage />);

  const banner = screen.getByRole("region", { name: "Zero Copy" });
  expect(banner.textContent).toContain("Completed");
  expect(screen.getByRole("button", { name: "Open again" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
});

it("gives the banner's place to the results line while searching", () => {
  render(<TutorialsPage />);
  search("zzz");

  expect(screen.queryByRole("region", { name: "Hello Anchor" })).toBeNull();
  expect(screen.getByRole("status").textContent).toBe(
    "No tutorials match “zzz”"
  );
});

it("shows a failed banner open on the banner", async () => {
  utils.PgTutorial.open.mockRejectedValue(new Error("Assets missing"));
  render(<TutorialsPage />);
  fireEvent.click(screen.getByRole("button", { name: "Start" }));

  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Assets missing");
  expect(
    screen.getByRole("region", { name: "Hello Anchor" }).contains(alert)
  ).toBe(true);
  expect(named("catalog_banner_opened")).toEqual([]);
});

it("filters by framework once the list holds two, and reports it", async () => {
  utils.PgTutorial.all = [
    helloAnchor(),
    tutorial("Lumberjack", "Intermediate", "Seahorse", "An energy system"),
  ];
  render(<TutorialsPage />);
  fireEvent.keyDown(
    screen.getByRole("button", { name: "Filter by framework" }),
    { key: "Enter" }
  );
  fireEvent.click(
    await screen.findByRole("menuitemradio", { name: "Seahorse" })
  );

  expect(named("catalog_filtered").map((e) => e.params)).toEqual([
    { page: "tutorials", framework: "Seahorse" },
  ]);
  expect(
    screen.getByRole("button", { name: "Framework: Seahorse" })
  ).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Open Hello Anchor" })
  ).toBeNull();
  expect(screen.getByRole("status").textContent).toBe("1 result");
  // A filter, like a search, takes the banner's place
  expect(screen.queryByRole("region", { name: "Hello Anchor" })).toBeNull();
  expect(
    screen.getByRole("searchbox", { name: "Search tutorials" })
  ).toHaveProperty("placeholder", "Search Seahorse tutorials");
});
