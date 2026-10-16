import { describe, expect, it } from "vitest";

import type { Connection } from "../../../views/sidebar/assistant/store";
import { withEffort, withModel } from "./tune";

const anthropic: Connection = {
  id: "anthropic",
  apiKey: "sk-ant-1",
  settings: { model: "claude-opus-5-5", effort: "high" },
};

const gemini: Connection = {
  id: "gemini",
  apiKey: "AIza-1",
  endpoint: { baseUrl: "https://proxy.example/v1", model: "gemini-3.6-flash" },
};

describe("withModel", () => {
  it("keeps the key and the effort on a model-settings backend", () => {
    expect(withModel(anthropic, "claude-sonnet-5-5")).toEqual({
      id: "anthropic",
      apiKey: "sk-ant-1",
      settings: { model: "claude-sonnet-5-5", effort: "high" },
    });
  });

  it("keeps the key and the base URL on an endpoint backend", () => {
    expect(withModel(gemini, "gemini-3.1-pro-preview")).toEqual({
      id: "gemini",
      apiKey: "AIza-1",
      endpoint: {
        baseUrl: "https://proxy.example/v1",
        model: "gemini-3.1-pro-preview",
      },
    });
  });

  it("starts from the provider's defaults when the connection names none", () => {
    expect(
      withModel({ id: "anthropic", apiKey: "k" }, "claude-sonnet-5-5")
    ).toEqual({
      id: "anthropic",
      apiKey: "k",
      settings: { model: "claude-sonnet-5-5", effort: "medium" },
    });
    expect(
      withModel({ id: "gemini", apiKey: "k" }, "gemini-3.1-pro-preview")
    ).toEqual({
      id: "gemini",
      apiKey: "k",
      endpoint: {
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        model: "gemini-3.1-pro-preview",
      },
    });
  });

  it("is null for the model already in use", () => {
    expect(withModel(anthropic, "claude-opus-5-5")).toBeNull();
    expect(withModel(gemini, "gemini-3.6-flash")).toBeNull();
  });

  it("is null for the default backend, whose model is the server's", () => {
    expect(withModel({ id: "default", apiKey: "" }, "anything")).toBeNull();
  });
});

describe("withEffort", () => {
  it("keeps the key and the model", () => {
    expect(withEffort(anthropic, "low")).toEqual({
      id: "anthropic",
      apiKey: "sk-ant-1",
      settings: { model: "claude-opus-5-5", effort: "low" },
    });
  });

  it("is null for the effort already in use", () => {
    expect(withEffort(anthropic, "high")).toBeNull();
  });

  it("is null for a backend that takes no effort", () => {
    expect(withEffort(gemini, "low")).toBeNull();
    expect(withEffort({ id: "default", apiKey: "" }, "low")).toBeNull();
  });
});
