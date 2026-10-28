import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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

const utils = vi.hoisted(() => {
  class ImportCancelledError extends Error {}
  return {
    ImportCancelledError,
    PgCommon: { fetchJSON: vi.fn() },
    PgGithub: { import: vi.fn() },
    PgTutorial: {
      all: [
        {
          name: "Hello Anchor",
          description: "Hello world with Anchor",
          thumbnail: "/hello.png",
          level: "Beginner",
          framework: "Anchor",
          authors: [{ name: "acheron" }],
          pageCount: 6,
        },
      ],
      open: vi.fn(),
    },
    PgView: { setToast: vi.fn() },
  };
});
vi.mock("@/utils", () => utils);
// Each tutorial's progress, by name: new unless a test says otherwise
const progress = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/entities/tutorial", () => ({
  useTutorialProgress: () => (name: string) =>
    progress.get(name) ?? { state: "new" },
}));
vi.mock("@/features/new-project", () => ({
  // Stands in for Start from scratch: it waits on `held`, says when it runs
  StartFromScratch: ({
    held,
    onRunning,
  }: {
    held: boolean;
    onRunning: (running: boolean) => void;
  }) => (
    <button
      type="button"
      data-testid="scratch"
      disabled={held}
      onClick={() => onRunning(true)}
    >
      Start
    </button>
  ),
}));

import { catalogPage } from "../model/catalog-page";
import { useNewProject } from "../model/use-new-project";
import type { CatalogPage } from "../model/telemetry";
import NewProjectView from "./NewProject";

/** The dialog's component: it holds the state, as `NewWorkspaceModal` does */
/** Closes the dialog New project sits in, as `NewWorkspaceModal` gives it */
const close = vi.fn();

/** The dialog's component: it holds the state, as `NewWorkspaceModal` does */
const NewProject = ({ initialTab }: { initialTab?: CatalogPage }) => (
  <NewProjectView project={useNewProject(close, initialTab)} />
);

const PROGRAM = {
  name: "drift",
  description: "Perps",
  repo: "https://github.com/x/drift",
  icon: "/drift.png",
  framework: "Anchor",
  categories: ["DeFi"],
};

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let sent: ReturnType<typeof memoryProvider>;
let logged: ReturnType<typeof memoryLogs>;
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", NoopResizeObserver);
  utils.PgCommon.fetchJSON.mockReset().mockResolvedValue([PROGRAM]);
  utils.PgGithub.import.mockReset().mockResolvedValue(undefined);
  utils.PgTutorial.open.mockReset().mockResolvedValue(undefined);
  close.mockReset();
  progress.clear();
  utils.PgView.setToast.mockReset();
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
  logged = memoryLogs();
  initLogger({ providers: [logged] });
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetTelemetry();
  resetLogger();
});

const named = (name: string) => sent.events.filter((e) => e.name === name);
const choice = (name: RegExp) => screen.getByRole("radio", { name });

it("holds Start from scratch, the two lists with their counts, and the tutorials", async () => {
  render(<NewProject />);

  expect(screen.getByTestId("scratch")).toBeTruthy();
  expect(choice(/Tutorials/).textContent).toBe("Tutorials1");
  expect(choice(/Programs/).textContent).toBe("Programs…");
  await waitFor(() => expect(choice(/Programs/).textContent).toBe("Programs1"));
  expect(choice(/Tutorials/).getAttribute("aria-checked")).toBe("true");
  expect(
    screen.getByRole("button", { name: "Open Hello Anchor" })
  ).toBeTruthy();
  expect(
    screen.getByRole("searchbox", { name: "Search tutorials" })
  ).toBeTruthy();
});

it("draws each tutorial as the tutorial card, with its level and framework", () => {
  render(<NewProject />);

  const open = screen.getByRole("button", { name: "Open Hello Anchor" });
  const card = open.closest<HTMLElement>('[data-slot="action-card"]')!;
  expect(within(card).getByText("Beginner · Anchor")).toBeTruthy();
  expect(within(card).queryByText(/\d+ of \d+/)).toBeNull();
  expect(within(card).getAllByRole("button")).toEqual([open]);
});

it("shows a failed tutorial Open on its own card and frees the others", async () => {
  utils.PgTutorial.all.push({
    name: "Hello Solana",
    description: "Hello world without a framework",
    thumbnail: "/solana.png",
    level: "Beginner",
    framework: "Native",
    authors: [{ name: "acheron" }],
    pageCount: 4,
  });
  utils.PgTutorial.open.mockRejectedValueOnce(new Error("gone"));
  render(<NewProject />);

  const anchor = screen.getByRole("button", { name: "Open Hello Anchor" });
  await act(async () => fireEvent.click(anchor));

  const card = (b: HTMLElement) =>
    b.closest<HTMLElement>('[data-slot="action-card"]')!;
  expect(within(card(anchor)).getByRole("alert").textContent).toBe("gone");
  const solana = screen.getByRole("button", { name: "Open Hello Solana" });
  expect(within(card(solana)).queryByRole("alert")).toBeNull();
  expect(solana).toHaveProperty("disabled", false);
  expect(close).not.toHaveBeenCalled();
  utils.PgTutorial.all.pop();
});

it("continues a started tutorial from the page it is on", () => {
  progress.set("Hello Anchor", { state: "started", page: 2, pages: 6 });
  render(<NewProject />);

  expect(
    screen.getByRole("button", { name: "Continue Hello Anchor" })
  ).toBeTruthy();
  expect(screen.getByText("2 of 6")).toBeTruthy();
});

it("keeps the programs' own card, with its Open button", async () => {
  render(<NewProject initialTab="programs" />);

  const open = await screen.findByRole("button", { name: "Open drift" });
  expect(open.textContent).toBe("Open");
});

it("switches to the programs and measures the switch", async () => {
  render(<NewProject />);

  fireEvent.click(choice(/Programs/));

  expect(
    await screen.findByRole("button", { name: "Open drift" })
  ).toBeTruthy();
  expect(
    screen.getByRole("searchbox", { name: "Search programs" })
  ).toBeTruthy();
  expect(named("catalog_tab_switched").map((e) => e.params)).toEqual([
    { tab: "programs" },
  ]);
});

it("opens on the tab it is given", async () => {
  render(<NewProject initialTab="programs" />);

  expect(
    await screen.findByRole("button", { name: "Open drift" })
  ).toBeTruthy();
  expect(named("catalog_tab_switched")).toEqual([]);
});

it("counts programs it could not read as ? and offers Try again", async () => {
  utils.PgCommon.fetchJSON
    .mockReset()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce([PROGRAM]);
  render(<NewProject initialTab="programs" />);

  const alert = await screen.findByRole("alert");
  expect(choice(/Programs/).textContent).toBe("Programs?");
  fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
  expect(
    await screen.findByRole("button", { name: "Open drift" })
  ).toBeTruthy();
});

it("closes the dialog once a card opens, and only then", async () => {
  render(<NewProject />);
  const open = screen.getByRole("button", { name: "Open Hello Anchor" });

  utils.PgTutorial.open.mockRejectedValueOnce(new Error("gone"));
  await act(async () => fireEvent.click(open));
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByText("gone")).toBeTruthy();

  await act(async () => fireEvent.click(open));
  expect(close).toHaveBeenCalledTimes(1);
});

it("leaves the catalog's pages alone: it closes its dialog, not a page", async () => {
  const pageClose = vi.spyOn(catalogPage, "close");
  render(<NewProject />);

  await act(async () =>
    fireEvent.click(screen.getByRole("button", { name: "Open Hello Anchor" }))
  );

  expect(close).toHaveBeenCalledTimes(1);
  expect(pageClose).not.toHaveBeenCalled();
  pageClose.mockRestore();
});

it("keeps a failed program list off the Tutorials list", async () => {
  utils.PgCommon.fetchJSON.mockReset().mockRejectedValue(new Error("offline"));
  render(<NewProject />);

  await waitFor(() => expect(choice(/Programs/).textContent).toBe("Programs?"));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(
    screen.getByRole("button", { name: "Open Hello Anchor" })
  ).toBeTruthy();
});

/** A promise and what settles it, for an Open held mid-way */
const held = () => {
  let release!: () => void;
  let fail!: (e: unknown) => void;
  const promise = new Promise<void>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  return { promise, release, fail };
};

it("holds the other list's Opens and Start while one Open runs", async () => {
  const open = held();
  utils.PgTutorial.open.mockReturnValueOnce(open.promise);
  render(<NewProject />);
  fireEvent.click(screen.getByRole("button", { name: "Open Hello Anchor" }));

  fireEvent.click(choice(/Programs/));
  const drift = await screen.findByRole("button", { name: "Open drift" });
  expect(drift).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "drift" }));
  expect(screen.getByTestId("scratch")).toHaveProperty("disabled", true);
  expect(utils.PgGithub.import).not.toHaveBeenCalled();

  await act(async () => open.release());
  expect(close).toHaveBeenCalledTimes(1);
});

it("holds every card while Start makes a project", async () => {
  render(<NewProject />);

  fireEvent.click(screen.getByTestId("scratch"));

  expect(
    screen.getByRole("button", { name: "Open Hello Anchor" })
  ).toHaveProperty("disabled", true);
});

it("keeps the dialog for a cancelled import, and says nothing", async () => {
  utils.PgGithub.import.mockRejectedValueOnce(new utils.ImportCancelledError());
  render(<NewProject initialTab="programs" />);

  const drift = await screen.findByRole("button", { name: "Open drift" });
  await act(async () => fireEvent.click(drift));

  expect(close).not.toHaveBeenCalled();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("shows a failed import on its card and keeps the dialog", async () => {
  utils.PgGithub.import.mockRejectedValueOnce(new Error("Rate limited"));
  render(<NewProject initialTab="programs" />);

  const drift = await screen.findByRole("button", { name: "Open drift" });
  await act(async () => fireEvent.click(drift));

  expect(screen.getByRole("alert").textContent).toBe("Rate limited");
  expect(close).not.toHaveBeenCalled();
});

it("keeps one query for both lists and counts each list whole", async () => {
  render(<NewProject />);
  await waitFor(() => expect(choice(/Programs/).textContent).toBe("Programs1"));

  fireEvent.change(
    screen.getByRole("searchbox", { name: "Search tutorials" }),
    {
      target: { value: "zzz" },
    }
  );
  fireEvent.click(choice(/Programs/));

  expect(
    screen.getByRole("searchbox", { name: "Search programs" })
  ).toHaveProperty("value", "zzz");
  expect(choice(/Tutorials/).textContent).toBe("Tutorials1");
  expect(choice(/Programs/).textContent).toBe("Programs1");
});

it("toasts an Open that fails after the dialog was dismissed", async () => {
  const open = held();
  utils.PgTutorial.open.mockReturnValueOnce(open.promise);
  const { unmount } = render(<NewProject />);
  fireEvent.click(screen.getByRole("button", { name: "Open Hello Anchor" }));

  unmount();
  await act(async () => open.fail(new Error("gone")));

  expect(utils.PgView.setToast).toHaveBeenCalledTimes(1);
});
