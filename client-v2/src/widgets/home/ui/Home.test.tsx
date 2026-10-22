import {
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

const utils = vi.hoisted(() => ({
  PgTutorial: {
    all: [] as unknown[],
    open: vi.fn(),
  },
  PgView: { setModal: vi.fn(), setToast: vi.fn() },
  PgCommon: { fetchJSON: vi.fn() },
}));
vi.mock("@/utils", () => utils);
// The scratch options pull in the legacy gallery and the whole `@/utils`
// barrel; Home only hands them on
vi.mock("@/views/flow/gallery/StartFromScratch", () => ({
  default: () => <div data-testid="scratch" />,
}));

import Home from "./Home";

let sent: ReturnType<typeof memoryProvider>;
let logged: ReturnType<typeof memoryLogs>;
/** 34 programs, each complete, as the listing the count is read from */
const LISTING = Array.from({ length: 34 }, (_, i) => ({
  name: `p${i}`,
  description: "d",
  repo: `https://github.com/x/p${i}`,
  icon: "/i.png",
  framework: "Anchor",
  categories: [],
}));

beforeEach(() => {
  utils.PgTutorial.all = [
    {
      name: "Hello Anchor",
      description: "d",
      level: "Beginner",
      framework: "Anchor",
      thumbnail: "/t.png",
    },
  ];
  utils.PgTutorial.open.mockReset().mockResolvedValue(undefined);
  utils.PgView.setModal.mockReset().mockResolvedValue(null);
  utils.PgView.setToast.mockReset();
  utils.PgCommon.fetchJSON.mockReset().mockResolvedValue(LISTING);
  sent = memoryProvider();
  initTelemetry({ providers: [sent] });
  logged = memoryLogs();
  initLogger({ providers: [logged] });
});
afterEach(() => {
  resetTelemetry();
  resetLogger();
});

const draw = () => {
  const onAsk = vi.fn();
  const onOpenPage = vi.fn();
  render(<Home onAsk={onAsk} onOpenPage={onOpenPage} />);
  return {
    home: within(screen.getByRole("region", { name: "Home" })),
    onAsk,
    onOpenPage,
  };
};
const events = (name: string) =>
  sent.events.filter((e) => e.name === name).map((e) => e.params);

it("opens the Programs page from the programs tile, and no gallery", async () => {
  const { home, onOpenPage } = draw();
  await home.findByText("34 real programs");
  fireEvent.click(home.getByRole("button", { name: "Open a program" }));
  expect(onOpenPage).toHaveBeenCalledWith("programs");
  expect(utils.PgView.setModal).not.toHaveBeenCalled();
  expect(events("home_tile_opened")).toEqual([{ tile: "programs" }]);
});

it("opens the Tutorials page from the tile and from All", async () => {
  const { home, onOpenPage } = draw();
  await home.findByText("34 real programs");
  fireEvent.click(home.getByRole("button", { name: "Follow a tutorial" }));
  fireEvent.click(home.getByRole("button", { name: "All 1" }));
  expect(onOpenPage.mock.calls).toEqual([["tutorials"], ["tutorials"]]);
  expect(utils.PgView.setModal).not.toHaveBeenCalled();
});

it("reports New project and unfolds the scratch options", async () => {
  const { home } = draw();
  await home.findByText("34 real programs");
  fireEvent.click(home.getByRole("button", { name: "New project" }));
  expect(events("home_tile_opened")).toEqual([{ tile: "new-project" }]);
  expect(home.getByTestId("scratch")).toBeTruthy();
});

it("opens a tutorial and reports it", async () => {
  const { home } = draw();
  await home.findByText("34 real programs");
  fireEvent.click(home.getByRole("button", { name: "Open Hello Anchor" }));
  await waitFor(() => expect(events("home_tutorial_opened")).toHaveLength(1));
  expect(utils.PgTutorial.open).toHaveBeenCalledWith("Hello Anchor");
});

it("tells the user once when a tutorial fails to open, and frees the button", async () => {
  const failure = new Error("no such tutorial");
  utils.PgTutorial.open.mockRejectedValueOnce(failure);
  const { home } = draw();
  await home.findByText("34 real programs");
  fireEvent.click(home.getByRole("button", { name: "Open Hello Anchor" }));
  await home.findByText("no such tutorial");
  expect(logged.entries).toHaveLength(1);
  expect(logged.entries[0].ns).toBe("home:actions");
  expect(logged.entries[0].report).toBe(true);
  expect(logged.entries[0].error).toBe(failure);
  expect(events("home_tutorial_opened")).toEqual([]);
  await waitFor(() =>
    expect(
      (
        home.getByRole("button", {
          name: "Open Hello Anchor",
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false)
  );
});

it("shows the message of a tutorial failure that is not an Error", async () => {
  utils.PgTutorial.open.mockRejectedValueOnce({ message: "quota exceeded" });
  const { home } = draw();
  await home.findByText("34 real programs");
  fireEvent.click(home.getByRole("button", { name: "Open Hello Anchor" }));
  expect(await home.findByText("quota exceeded")).toBeTruthy();
});

it("opens the assistant from the composer and reports it", async () => {
  const { home, onAsk } = draw();
  await home.findByText("34 real programs");
  fireEvent.click(home.getByRole("button", { name: "Ask the assistant" }));
  expect(onAsk).toHaveBeenCalledTimes(1);
  expect(events("home_composer_opened")).toEqual([{}]);
});

it("reads the program count from the registry", async () => {
  const { home } = draw();
  await home.findByText("34 real programs");
  expect(utils.PgCommon.fetchJSON).toHaveBeenCalledWith(
    "/programs/programs.json"
  );
});

it("shows an ellipsis and logs quietly when the registry cannot be read", async () => {
  const failure = new Error("offline");
  utils.PgCommon.fetchJSON.mockRejectedValueOnce(failure);
  const { home } = draw();
  await waitFor(() =>
    expect(logged.entries.some((e) => e.error === failure)).toBe(true)
  );
  expect(home.getByText("… real programs")).toBeTruthy();
  expect(logged.entries.find((e) => e.error === failure)?.report).toBe(false);
  expect(logged.entries.find((e) => e.error === failure)?.ns).toBe(
    "home:programs"
  );
});

it("keeps the ellipsis and logs the URL when the registry is not a list", async () => {
  utils.PgCommon.fetchJSON.mockResolvedValueOnce({ programs: [] });
  const { home } = draw();
  await waitFor(() => expect(logged.entries).toHaveLength(1));
  expect(home.getByText("… real programs")).toBeTruthy();
  expect(logged.entries[0].ns).toBe("home:programs");
  expect(logged.entries[0].report).toBe(false);
  expect(String(logged.entries[0].error)).toContain("/programs/programs.json");
});
