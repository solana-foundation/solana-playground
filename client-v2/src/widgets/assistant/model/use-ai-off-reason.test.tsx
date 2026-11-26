import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AI_OFF_SEND_HINT } from "../ui/BaseAiOffRow";
import type { DefaultBackend } from "./default-backend";
import { useAiOffReason } from "./use-ai-off-reason";

const state = vi.hoisted(() => ({
  backend: { state: "checking" } as DefaultBackend,
  signedIn: undefined as boolean | undefined,
  connection: undefined as { id: string } | undefined,
  listeners: new Set<() => void>(),
}));

vi.mock("@/features/auth", () => ({ useSignedIn: () => state.signedIn }));
vi.mock("./default-backend", () => ({
  useDefaultBackend: () => state.backend,
}));
vi.mock("../../../views/sidebar/assistant/store", () => ({
  PgAssistant: {
    get connection() {
      return state.connection;
    },
    onDidChange: (cb: () => void) => {
      state.listeners.add(cb);
      return { dispose: () => state.listeners.delete(cb) };
    },
  },
}));

const present: DefaultBackend = { state: "present", model: "m" };

afterEach(() => {
  state.backend = { state: "checking" };
  state.signedIn = undefined;
  state.connection = undefined;
  state.listeners.clear();
});

describe("useAiOffReason", () => {
  it("says signed-out while the deployment offers a model to a signed-out user", () => {
    state.backend = present;
    state.signedIn = false;
    expect(renderHook(useAiOffReason).result.current).toBe("signed-out");
  });

  it("says no-key while the deployment offers no hosted model", () => {
    state.backend = { state: "absent" };
    state.signedIn = true;
    expect(renderHook(useAiOffReason).result.current).toBe("no-key");
  });

  it("says nothing while a model can answer or that is not known yet", () => {
    state.backend = present;
    state.signedIn = true;
    expect(renderHook(useAiOffReason).result.current).toBeUndefined();
    state.backend = { state: "checking" };
    expect(renderHook(useAiOffReason).result.current).toBeUndefined();
  });

  it("follows the assistant: a key connected later turns the reason off", () => {
    state.backend = { state: "absent" };
    const { result, unmount } = renderHook(useAiOffReason);
    expect(result.current).toBe("no-key");

    state.connection = { id: "openai" };
    act(() => state.listeners.forEach((cb) => cb()));
    expect(result.current).toBeUndefined();

    unmount();
    expect(state.listeners.size).toBe(0);
  });
});

describe("AI_OFF_SEND_HINT", () => {
  it("says what a send needs, and nothing while the model is only out of reach", () => {
    expect(AI_OFF_SEND_HINT).toEqual({
      "signed-out": "Sign in or add a key to send",
      "no-key": "Add a key to send",
      unreachable: undefined,
    });
  });
});
