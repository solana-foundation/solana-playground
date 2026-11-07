import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { PgAnalyzerStatus } from "@/components/Editor/Monaco/languages/rust/rust-analyzer/status";

import { useStatus } from "./use-status";

const flow = vi.hoisted(() => ({
  state: { build: "upcoming", deploy: "upcoming" },
}));

const assistant = vi.hoisted(() => ({
  connection: null as null | {
    id: string;
    settings?: { model: string };
    endpoint?: { model: string };
  },
  needsSignIn: false,
  defaultProbe: "unasked" as string,
  limitReachedUntil: undefined as number | undefined,
  hostedModel: undefined as string | undefined,
}));

vi.mock("@/utils", () => ({}));
vi.mock("@/entities/cluster", () => ({
  useSelectedConnection: () => ({
    connection: undefined,
    cluster: "devnet",
    isConnected: true,
    isClusterDown: false,
  }),
}));
vi.mock("@/views/flow/state/stage", () => ({
  PgFlow: {
    get state() {
      return flow.state;
    },
    onDidChange: () => ({ dispose: () => {} }),
  },
}));
vi.mock("@/features/auth", () => ({
  PgSession: { onDidChange: () => ({ dispose: () => {} }) },
}));
vi.mock("@/views/sidebar/assistant/store", () => ({
  PgAssistant: {
    get connection() {
      return assistant.connection;
    },
    get needsSignIn() {
      return assistant.needsSignIn;
    },
    get defaultProbe() {
      return assistant.defaultProbe;
    },
    get hostedModel() {
      return assistant.hostedModel;
    },
    get limitReachedUntil() {
      return assistant.limitReachedUntil;
    },
    onDidChange: () => ({ dispose: () => {} }),
  },
}));

const wordsOf = () => renderHook(() => useStatus()).result;

beforeEach(() => vi.useFakeTimers({ toFake: ["Date", "setInterval"] }));
afterEach(() => {
  vi.useRealTimers();
  assistant.connection = null;
  assistant.needsSignIn = false;
  assistant.defaultProbe = "unasked";
  assistant.limitReachedUntil = undefined;
  assistant.hostedModel = undefined;
  PgAnalyzerStatus.set({ kind: "idle" });
});

it("reads the AI as off for the default backend while signed out", () => {
  assistant.connection = { id: "default", settings: { model: "x" } };
  assistant.needsSignIn = true;
  expect(wordsOf().current[1].words).toBe("AI · Off");
});

it("names the connected model by its display name", () => {
  assistant.connection = {
    id: "anthropic",
    settings: { model: "claude-opus-5-5" },
  };
  expect(wordsOf().current[1].words).toBe("Opus 5.5");
});

it("names the hosted default by its model, never by the backend's id", () => {
  assistant.connection = { id: "default" };
  expect(wordsOf().current[1].words).toBe("Default model");
  assistant.hostedModel = "claude-opus-5-5";
  expect(wordsOf().current[1].words).toBe("Opus 5.5");
});

it("reads Off while the hosted model is asked for, and Not responding once the asking failed", () => {
  // No "Checking" (DES-126): the row reads as it did before it asked
  assistant.defaultProbe = "checking";
  expect(wordsOf().current[1].words).toBe("AI · Off");
  assistant.defaultProbe = "unreachable";
  expect(wordsOf().current[1].words).toBe("AI · Not responding");
  assistant.defaultProbe = "answered";
  expect(wordsOf().current[1].words).toBe("AI · Off");
});

it("leaves a connected backend to its turns, whatever the probe says", () => {
  assistant.connection = {
    id: "anthropic",
    settings: { model: "claude-opus-5-5" },
  };
  assistant.defaultProbe = "unreachable";
  expect(wordsOf().current[1].words).toBe("Opus 5.5");
});

it("reads Limit reached on the connected default until the limit comes back", () => {
  assistant.connection = { id: "default" };
  assistant.limitReachedUntil = Date.now() + 60_000;
  expect(wordsOf().current[1].words).toBe("AI · Limit reached");
});

it("counts the analyzer's start each second, then takes longer", () => {
  PgAnalyzerStatus.set({ kind: "starting", since: Date.now() });
  const result = wordsOf();
  act(() => vi.advanceTimersByTime(12_000));
  expect(result.current[2].words).toBe("Rust · Starting 12 s");
  act(() => vi.advanceTimersByTime(48_000));
  expect(result.current[2].words).toBe("Rust · Taking longer");
  act(() => PgAnalyzerStatus.set({ kind: "ready" }));
  expect(result.current[2].words).toBe("Rust · Ready");
});

it("reads all three offline, and back", () => {
  const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  const result = wordsOf();
  expect(result.current[0].words).toBe("Devnet");
  online.mockReturnValue(false);
  act(() => {
    window.dispatchEvent(new Event("offline"));
  });
  expect(result.current.map((i) => i.words)).toEqual([
    "Devnet · Offline",
    "AI · Offline",
    "Rust · Offline",
  ]);
  online.mockReturnValue(true);
  act(() => {
    window.dispatchEvent(new Event("online"));
  });
  expect(result.current[0].words).toBe("Devnet");
  online.mockRestore();
});

it("keeps the analyzer's Reload away from a first build under way", () => {
  flow.state = { build: "running", deploy: "upcoming" };
  act(() => PgAnalyzerStatus.set({ kind: "failed" }));
  const { result } = renderHook(() => useStatus());
  expect(result.current[2]?.action).toBeUndefined();
  flow.state = { build: "done", deploy: "active" };
});
