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

import { catalogPage } from "../model/catalog-page";
import TutorialsPage from "./TutorialsPage";

const tutorial = (name: string, description: string) => ({
  name,
  description,
  level: "Beginner",
  framework: "Anchor",
  thumbnail: `/${name}.png`,
});

let sent: ReturnType<typeof memoryProvider>;
let logged: ReturnType<typeof memoryLogs>;
beforeEach(() => {
  utils.PgTutorial.all = [
    tutorial("Hello Anchor", "Hello world with Anchor"),
    tutorial("Hello Seahorse", "Hello world with Seahorse"),
  ];
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

it("finds a tutorial by search", () => {
  render(<TutorialsPage />);
  search("seahorse");

  expect(
    screen.queryByRole("button", { name: "Open Hello Anchor" })
  ).toBeNull();
  expect(
    screen.getByRole("button", { name: "Open Hello Seahorse" })
  ).toBeTruthy();
});

it("opens a tutorial, reports it and leaves the page", async () => {
  // Opening the lesson already open changes no route, so the page closes
  // itself rather than waiting on one
  catalogPage.open("tutorials", "nav");
  render(<TutorialsPage />);
  fireEvent.click(screen.getByRole("button", { name: "Open Hello Seahorse" }));

  await waitFor(() => expect(named("catalog_item_opened")).toHaveLength(1));
  expect(utils.PgTutorial.open).toHaveBeenCalledWith("Hello Seahorse");
  expect(named("catalog_item_opened")[0].params).toEqual({ page: "tutorials" });
  expect(catalogPage.current()).toBeNull();
});

it("refuses a second Open while one runs", () => {
  utils.PgTutorial.open.mockReturnValue(new Promise<void>(() => {}));
  render(<TutorialsPage />);
  fireEvent.click(screen.getByRole("button", { name: "Open Hello Anchor" }));
  fireEvent.click(screen.getByRole("button", { name: "Hello Seahorse" }));

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

it("reports a search once typing rests", () => {
  vi.useFakeTimers();
  render(<TutorialsPage />);
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

it("reports no search for a cleared field", () => {
  vi.useFakeTimers();
  render(<TutorialsPage />);
  search("anchor");
  act(() => vi.advanceTimersByTime(100));
  search("");
  act(() => vi.advanceTimersByTime(1000));

  expect(named("catalog_searched")).toEqual([]);
});
