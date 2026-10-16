// `@types/mocha` also declares a global `it`, without `each`
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { initLogger, memoryProvider, resetLogger } from "@/shared/lib/logger";
import { storedValues } from "../../../../test-utils/stored-values";
import type { Connection } from "../store";
import {
  forgetBackend,
  isDefaultBackendRemembered,
  rememberBackend,
  rememberedConnection,
} from "./remembered-backend";

const KEY = "sk-test-0123456789";

const openai: Connection = {
  id: "openai",
  apiKey: KEY,
  endpoint: { baseUrl: "https://api.example.test/v1", model: "gpt-x" },
};
const anthropic: Connection = {
  id: "anthropic",
  apiKey: KEY,
  settings: { model: "claude-opus-5", effort: "high" },
};
const defaultBackend: Connection = { id: "default", apiKey: "" };

describe("remembered backend", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetLogger();
  });

  it("remembers nothing until a backend has been chosen", () => {
    expect(isDefaultBackendRemembered()).toBe(false);
    expect(rememberedConnection()).toBeNull();
  });

  it("remembers the default backend in localStorage only", () => {
    rememberBackend(defaultBackend);
    expect(isDefaultBackendRemembered()).toBe(true);
    expect(rememberedConnection()).toBeNull();
  });

  it("keeps a key-based connection for this tab", () => {
    rememberBackend(openai);
    expect(rememberedConnection()).toEqual(openai);
    expect(isDefaultBackendRemembered()).toBe(false);
  });

  it("keeps model settings for a backend without a base URL", () => {
    rememberBackend(anthropic);
    expect(rememberedConnection()).toEqual(anthropic);
  });

  it("never writes the key to localStorage", () => {
    rememberBackend(openai);
    expect(JSON.stringify(storedValues(localStorage))).not.toContain(KEY);
  });

  it("drops the key once the default backend is chosen", () => {
    rememberBackend(openai);
    rememberBackend(defaultBackend);
    expect(rememberedConnection()).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  it("forgets both on request", () => {
    rememberBackend(defaultBackend);
    rememberBackend(openai);
    expect(forgetBackend()).toBe(true);
    expect(isDefaultBackendRemembered()).toBe(false);
    expect(rememberedConnection()).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  it.each([
    ["not JSON", "{", "not-json"],
    ["a blanked entry", "", "blank"],
    ["a JSON value that is not an object", "42", "not-an-object"],
    ["JSON null", "null", "not-an-object"],
    [
      "an unknown provider",
      JSON.stringify({ id: "nope", apiKey: KEY }),
      "unknown-provider",
    ],
    [
      "the default backend",
      JSON.stringify({ id: "default", apiKey: "" }),
      "default-backend",
    ],
    ["no key", JSON.stringify({ id: "openai" }), "no-key"],
    [
      "a blank key for a provider that needs one",
      JSON.stringify({
        id: "anthropic",
        apiKey: " ",
        settings: anthropic.settings,
      }),
      "no-key",
    ],
    [
      "an OpenAI-compatible provider with no endpoint",
      JSON.stringify({ id: "openai", apiKey: KEY }),
      "bad-endpoint",
    ],
    [
      "a half endpoint",
      JSON.stringify({ id: "openai", apiKey: KEY, endpoint: { baseUrl: "x" } }),
      "bad-endpoint",
    ],
    [
      "an endpoint for a provider that has none",
      JSON.stringify({
        id: "anthropic",
        apiKey: KEY,
        endpoint: openai.endpoint,
        settings: anthropic.settings,
      }),
      "bad-endpoint",
    ],
    [
      "settings without a string model",
      JSON.stringify({
        id: "anthropic",
        apiKey: KEY,
        settings: { model: 5, effort: "high" },
      }),
      "bad-settings",
    ],
    [
      "an effort the provider does not offer",
      JSON.stringify({
        id: "anthropic",
        apiKey: KEY,
        settings: { model: "m", effort: "turbo" },
      }),
      "bad-settings",
    ],
  ])("drops a stored value with %s", (_, raw, reason) => {
    const logged = memoryProvider();
    initLogger({ providers: [logged] });
    sessionStorage.setItem("assistant.connection", raw);

    expect(rememberedConnection()).toBeNull();
    expect(sessionStorage.getItem("assistant.connection")).toBeNull();
    // Why it was dropped, and never the value it was dropped for
    expect(logged.entries).toContainEqual(
      expect.objectContaining({ context: { reason } })
    );
    expect(JSON.stringify(logged.entries)).not.toContain(KEY);
  });

  it("keeps a blank key for a provider whose key is optional", () => {
    const proxy: Connection = {
      id: "openai",
      apiKey: "",
      endpoint: { baseUrl: "http://localhost:4000/v1", model: "local" },
    };
    rememberBackend(proxy);
    expect(rememberedConnection()).toEqual(proxy);
  });

  it("carries no field it does not know", () => {
    sessionStorage.setItem(
      "assistant.connection",
      JSON.stringify({
        id: "openai",
        apiKey: KEY,
        endpoint: openai.endpoint,
        extra: 1,
      })
    );
    expect(rememberedConnection()).toEqual(openai);
  });

  it("answers no when storage refuses to say", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(isDefaultBackendRemembered()).toBe(false);
    expect(rememberedConnection()).toBeNull();
  });

  it("logs a refused write without the key", () => {
    const logged = memoryProvider();
    initLogger({ providers: [logged] });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    expect(() => rememberBackend(openai)).not.toThrow();

    expect(logged.entries.length).toBeGreaterThan(0);
    for (const entry of logged.entries) {
      expect(entry).toMatchObject({
        ns: "assistant:remembered-backend",
        report: false,
      });
    }
    expect(JSON.stringify(logged.entries)).not.toContain(KEY);
  });

  type StorageMethod = "getItem" | "setItem" | "removeItem";

  /** Make the given Storage methods throw for `sessionStorage` only */
  const failOnSession = (...methods: StorageMethod[]) => {
    for (const method of methods) {
      const original = Storage.prototype[method] as (
        ...args: string[]
      ) => unknown;
      vi.spyOn(Storage.prototype, method).mockImplementation(function (
        this: Storage,
        ...args: string[]
      ) {
        if (this === sessionStorage) throw new Error("blocked");
        return original.apply(this, args);
      } as never);
    }
  };

  /** Log entries meant for error tracking */
  const reported = (logged: ReturnType<typeof memoryProvider>) =>
    logged.entries.filter((e) => e.report);

  it("does not leave an earlier key behind when the new one cannot be kept", () => {
    rememberBackend(openai);
    failOnSession("setItem");

    rememberBackend(anthropic);

    expect(rememberedConnection()).toBeNull();
  });

  it("does not leave the key behind when the default cannot remove it", () => {
    rememberBackend(openai);
    failOnSession("removeItem");

    rememberBackend(defaultBackend);

    expect(rememberedConnection()).toBeNull();
  });

  it("blanks a key it cannot remove, and reports nothing", () => {
    const logged = memoryProvider();
    initLogger({ providers: [logged] });
    rememberBackend(openai);
    failOnSession("removeItem");

    expect(forgetBackend()).toBe(true);

    expect(rememberedConnection()).toBeNull();
    expect(reported(logged)).toEqual([]);
    expect(JSON.stringify(logged.entries)).not.toContain(KEY);
  });

  it("reports a key that survives a disconnect, without the key", () => {
    const logged = memoryProvider();
    initLogger({ providers: [logged] });
    rememberBackend(openai);
    failOnSession("removeItem", "setItem");

    expect(forgetBackend()).toBe(false);

    const failures = reported(logged);
    expect(failures).toHaveLength(1);
    expect(failures[0].ns).toBe("assistant:remembered-backend");
    expect(JSON.stringify(logged.entries)).not.toContain(KEY);
  });

  it("reports a key a failed write could not drop", () => {
    const logged = memoryProvider();
    initLogger({ providers: [logged] });
    rememberBackend(openai);
    failOnSession("removeItem", "setItem");

    rememberBackend(anthropic);

    expect(reported(logged)).toHaveLength(1);
    expect(JSON.stringify(logged.entries)).not.toContain(KEY);
  });

  it("reports nothing when storage is blocked outright", () => {
    const logged = memoryProvider();
    initLogger({ providers: [logged] });
    failOnSession("getItem", "setItem", "removeItem");
    rememberBackend(openai);

    // Nothing could be written, so there is no key to have survived
    expect(forgetBackend()).toBe(true);
    expect(reported(logged)).toEqual([]);
  });
});
