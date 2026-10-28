import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

const utils = vi.hoisted(() => {
  class ImportCancelledError extends Error {}
  return {
    ImportCancelledError,
    PgCommon: { fetchJSON: vi.fn() },
    PgGithub: { import: vi.fn() },
  };
});
vi.mock("@/utils", () => utils);

import { catalogPage } from "../model/catalog-page";
import ProgramsPage from "./ProgramsPage";
import { PROGRAMS_URL } from "@/entities/program";

const program = (name: string, categories: string[]) => ({
  name,
  description: `About ${name}`,
  repo: `https://github.com/x/${name}`,
  icon: `/${name}.png`,
  framework: "Anchor",
  categories,
});
const LISTING = [
  program("drift-v2", ["DeFi"]),
  program("mpl-bubblegum", ["NFT"]),
];

let sent: ReturnType<typeof memoryProvider>;
let logged: ReturnType<typeof memoryLogs>;
beforeEach(() => {
  utils.PgCommon.fetchJSON.mockReset().mockResolvedValue(LISTING);
  utils.PgGithub.import.mockReset().mockResolvedValue(undefined);
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
  logged = memoryLogs();
  initLogger({ providers: [logged] });
});
afterEach(() => {
  catalogPage.close();
  resetTelemetry();
  resetLogger();
});

const named = (name: string) => sent.events.filter((e) => e.name === name);

it("lists the programs the registry returns", async () => {
  render(<ProgramsPage />);

  expect(
    await screen.findByRole("button", { name: "Open drift-v2" })
  ).toBeTruthy();
  expect(utils.PgCommon.fetchJSON).toHaveBeenCalledWith(PROGRAMS_URL);
  expect(screen.getByText("Anchor · NFT")).toBeTruthy();
});

it("finds a program by its category", async () => {
  render(<ProgramsPage />);
  await screen.findByRole("button", { name: "Open drift-v2" });
  fireEvent.change(screen.getByRole("searchbox", { name: "Search programs" }), {
    target: { value: "nft" },
  });

  expect(screen.queryByRole("button", { name: "Open drift-v2" })).toBeNull();
  expect(
    screen.getByRole("button", { name: "Open mpl-bubblegum" })
  ).toBeTruthy();
});

it("reports a list it cannot read and recovers on Try again", async () => {
  utils.PgCommon.fetchJSON
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(LISTING);
  render(<ProgramsPage />);

  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
  expect(
    await screen.findByRole("button", { name: "Open drift-v2" })
  ).toBeTruthy();
  expect(logged.entries.map((e) => [e.ns, e.report])).toEqual([
    ["catalog:programs", true],
  ]);
});

it("shows Try again for a listing it cannot read, and reports it", async () => {
  utils.PgCommon.fetchJSON.mockResolvedValue({ error: "upstream" });
  render(<ProgramsPage />);

  expect(await screen.findByRole("button", { name: "Try again" })).toBeTruthy();
  expect(logged.entries.map((e) => [e.ns, e.report])).toEqual([
    ["catalog:programs", true],
  ]);
});

it("refuses a second Open while an import runs", async () => {
  utils.PgGithub.import.mockReturnValue(new Promise<void>(() => {}));
  render(<ProgramsPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Open drift-v2" }));

  fireEvent.click(screen.getByRole("button", { name: "Open mpl-bubblegum" }));
  fireEvent.click(screen.getByRole("button", { name: "drift-v2" }));
  expect(utils.PgGithub.import).toHaveBeenCalledTimes(1);
  expect(
    (screen.getByRole("button", { name: "mpl-bubblegum" }) as HTMLButtonElement)
      .disabled
  ).toBe(true);
});

it("imports a program with its progress on the card, and reports it", async () => {
  let progress: (p: {
    loaded: number;
    total: number | null;
  }) => void = () => {};
  let finish: () => void = () => {};
  utils.PgGithub.import.mockImplementation(
    (_repo: string, onProgress: typeof progress) => {
      progress = onProgress;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    }
  );
  catalogPage.open("programs", "nav");
  render(<ProgramsPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Open drift-v2" }));

  progress({ loaded: 3, total: 10 });
  expect(await screen.findByText("Downloading 3/10 files…")).toBeTruthy();
  finish();
  await waitFor(() => expect(named("catalog_item_opened")).toHaveLength(1));
  expect(utils.PgGithub.import.mock.calls[0][0]).toBe(LISTING[0].repo);
  // The project it opened takes the page's place
  expect(catalogPage.current()).toBeNull();
  expect(screen.queryByText("Downloading 3/10 files…")).toBeNull();
});

it("treats a cancelled import as no failure, and stays", async () => {
  utils.PgGithub.import.mockRejectedValue(new utils.ImportCancelledError());
  catalogPage.open("programs", "nav");
  sent.events.length = 0;
  render(<ProgramsPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Open drift-v2" }));

  await waitFor(() => expect(utils.PgGithub.import).toHaveBeenCalled());
  await new Promise((r) => setTimeout(r, 0));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(sent.events.filter((e) => e.name !== "catalog_searched")).toEqual([]);
  expect(logged.entries).toEqual([]);
  expect(catalogPage.current()).toBe("programs");
});

it("shows a failed import on its card, reports it and stays", async () => {
  utils.PgGithub.import.mockRejectedValue(new Error("Rate limited"));
  catalogPage.open("programs", "nav");
  render(<ProgramsPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Open drift-v2" }));

  expect((await screen.findByRole("alert")).textContent).toBe("Rate limited");
  expect(named("catalog_open_failed")[0].params).toEqual({ page: "programs" });
  expect(named("catalog_item_opened")).toEqual([]);
  expect(logged.entries.map((e) => e.ns)).toEqual(["catalog:open"]);
  expect(catalogPage.current()).toBe("programs");
  // Failed, the Open is offered again
  expect(
    (screen.getByRole("button", { name: "Open drift-v2" }) as HTMLButtonElement)
      .disabled
  ).toBe(false);
});
