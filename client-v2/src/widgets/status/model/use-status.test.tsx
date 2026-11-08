import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { PgAnalyzerStatus } from "@/components/Editor/Monaco/languages/rust/rust-analyzer/status";

import { useStatus } from "./use-status";

const assistant = vi.hoisted(() => ({
  connection: null as null | {
    id: string;
    settings?: { model: string };
    endpoint?: { model: string };
  },
  needsSignIn: false,
}));

vi.mock("@/utils", () => ({}));
vi.mock("@/entities/cluster", () => ({
  clusterName: (cluster: string) => cluster,
  useSelectedConnection: () => ({
    connection: undefined,
    cluster: "devnet",
    isConnected: true,
    isClusterDown: false,
  }),
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
    onDidChange: () => ({ dispose: () => {} }),
  },
}));

const wordsOf = () => renderHook(() => useStatus()).result;

beforeEach(() => vi.useFakeTimers({ toFake: ["Date", "setInterval"] }));
afterEach(() => {
  vi.useRealTimers();
  assistant.connection = null;
  assistant.needsSignIn = false;
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
