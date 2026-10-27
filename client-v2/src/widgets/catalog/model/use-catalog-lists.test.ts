import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import {
  initLogger,
  memoryProvider as memoryLogs,
  resetLogger,
} from "@/shared/lib/logger";

const deps = vi.hoisted(() => ({
  fetchPrograms: vi.fn(),
  PgTutorial: {
    all: [] as {
      name: string;
      description: string;
      thumbnail: string;
      level: string;
      framework?: string;
      authors: { name: string }[];
    }[],
  },
}));
vi.mock("@/entities/program", () => ({
  fetchPrograms: deps.fetchPrograms,
  PROGRAMS_URL: "/programs/programs.json",
}));
vi.mock("@/utils", () => ({ PgTutorial: deps.PgTutorial }));
// Each tutorial's progress, by name: new unless a test says otherwise
const progress = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@/entities/tutorial", () => ({
  useTutorialProgress: () => (name: string) =>
    progress.get(name) ?? { state: "new" },
}));

import { useProgramList } from "./use-program-list";
import { useTutorialList } from "./use-tutorial-list";

const tutorial = (name: string) => ({
  name,
  description: `About ${name}`,
  thumbnail: `/${name}.png`,
  level: "Beginner",
  framework: "Anchor",
  authors: [{ name: "acheron" }],
});
const program = (name: string, categories = ["DeFi"]) => ({
  name,
  description: `About ${name}`,
  repo: `https://github.com/x/${name}`,
  icon: `/${name}.png`,
  framework: "Anchor",
  categories,
});
const noOpen = () => undefined;

let logged: ReturnType<typeof memoryLogs>;
beforeEach(() => {
  deps.PgTutorial.all = [tutorial("Hello Anchor"), tutorial("Escrow")];
  progress.clear();
  deps.fetchPrograms
    .mockReset()
    .mockResolvedValue([program("drift"), program("bubblegum")]);
  logged = memoryLogs();
  initLogger({ providers: [logged] });
});
afterEach(() => resetLogger());

it("counts every tutorial whatever the query", () => {
  const { result } = renderHook(() => useTutorialList("escrow", noOpen));

  expect(result.current.count).toBe(2);
  expect(result.current.list).toEqual({
    state: "ready",
    cards: [expect.objectContaining({ id: "Escrow" })],
  });
});

it("carries each tutorial's progress and what its caption needs", () => {
  progress.set("Escrow", { state: "completed" });
  const { result } = renderHook(() => useTutorialList("", noOpen));

  const list = result.current.list;
  expect(list.state === "ready" && list.cards[1]).toEqual({
    id: "Escrow",
    title: "Escrow",
    description: "About Escrow",
    framework: "Anchor",
    level: "Beginner",
    authors: [{ name: "acheron" }],
    progress: { state: "completed" },
    open: undefined,
  });
});

it("puts a card's Open on its card", () => {
  const { result } = renderHook(() =>
    useTutorialList("", (id) =>
      id === "Escrow" ? { state: "failed", message: "gone" } : undefined
    )
  );

  const list = result.current.list;
  expect(list.state === "ready" && list.cards[1].open).toEqual({
    state: "failed",
    message: "gone",
  });
});

it("has no program count until the list is read", async () => {
  const { result } = renderHook(() => useProgramList("drift", noOpen));

  expect(result.current.count).toBe("loading");
  expect(result.current.list).toEqual({ state: "loading" });
  await waitFor(() => expect(result.current.count).toBe(2));
  const list = result.current.list;
  expect(list.state === "ready" && list.cards.map((c) => c.title)).toEqual([
    "drift",
  ]);
});

it("reports a program list it cannot read, and Retry reads it again", async () => {
  deps.fetchPrograms
    .mockReset()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce([program("drift")]);
  const { result } = renderHook(() => useProgramList("", noOpen));

  await waitFor(() => expect(result.current.count).toBe("failed"));
  expect(logged.entries.map((e) => [e.ns, e.report])).toEqual([
    ["catalog:programs", true],
  ]);
  const list = result.current.list;
  act(() => {
    if (list.state === "failed") list.onRetry();
  });
  await waitFor(() => expect(result.current.count).toBe(1));
});

it("tags a program with its framework and first category only", async () => {
  deps.fetchPrograms
    .mockReset()
    .mockResolvedValue([
      program("drift", ["DeFi", "Lending", "Trading"]),
      program("bare", []),
    ]);
  const { result } = renderHook(() => useProgramList("", noOpen));

  await waitFor(() => expect(result.current.count).toBe(2));
  const list = result.current.list;
  expect(list.state === "ready" && list.cards.map((c) => c.tags)).toEqual([
    [{ label: "Anchor" }, { label: "DeFi" }],
    [{ label: "Anchor" }],
  ]);
});

it("still finds a program by a category its card leaves out", async () => {
  deps.fetchPrograms
    .mockReset()
    .mockResolvedValue([program("drift", ["DeFi", "Lending"])]);
  const { result } = renderHook(() => useProgramList("lending", noOpen));

  await waitFor(() => expect(result.current.count).toBe(1));
  const list = result.current.list;
  expect(list.state === "ready" && list.cards.length).toBe(1);
});
