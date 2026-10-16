import { describe, expect, it } from "vitest";

import type { Effort } from "../../../views/sidebar/assistant/model/types";
import type { Connection } from "../../../views/sidebar/assistant/store";
import type { DefaultBackend } from "./default-backend";
import { modelOptions, modelShown } from "./choice";

const present: DefaultBackend = {
  state: "present",
  model: "z-ai/glm-5.3-flash:US",
};
const presentUnnamed: DefaultBackend = { state: "present", model: null };
const absent: DefaultBackend = { state: "absent" };
const checking: DefaultBackend = { state: "checking" };

describe("modelShown", () => {
  it("names the deployment's default before anything is connected", () => {
    expect(modelShown(null, present)).toEqual({
      kind: "default",
      label: "GLM 5.3 Flash",
      connected: false,
    });
  });

  it("calls an unnamed default 'Default model'", () => {
    expect(modelShown(null, presentUnnamed)).toEqual({
      kind: "default",
      label: "Default model",
      connected: false,
    });
  });

  it("shows nothing to send to when the default is absent", () => {
    expect(modelShown(null, absent)).toEqual({ kind: "none" });
  });

  it("says it is checking while the default is being asked about", () => {
    expect(modelShown(null, checking)).toEqual({ kind: "checking" });
  });

  it("marks a connected default as connected, with no effort", () => {
    const connection: Connection = { id: "default", apiKey: "" };
    expect(modelShown(connection, present)).toEqual({
      kind: "default",
      label: "GLM 5.3 Flash",
      connected: true,
    });
  });

  it("shows a connected Anthropic model with its effort ladder", () => {
    const connection: Connection = {
      id: "anthropic",
      apiKey: "k",
      settings: { model: "claude-opus-5-5", effort: "medium" },
    };
    expect(modelShown(connection, absent)).toEqual({
      kind: "keyed",
      provider: "anthropic",
      model: "claude-opus-5-5",
      label: "Opus 5.5",
      effort: {
        value: "medium",
        ladder: ["low", "medium", "high", "xhigh", "max"],
      },
    });
  });

  it("shows a connected Gemini model with no effort", () => {
    const connection: Connection = {
      id: "gemini",
      apiKey: "k",
      endpoint: {
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        model: "gemini-3.6-flash",
      },
    };
    expect(modelShown(connection, absent)).toEqual({
      kind: "keyed",
      provider: "gemini",
      model: "gemini-3.6-flash",
      label: "Gemini 3.6 Flash",
      effort: null,
    });
  });
});

describe("modelShown with a connection that names no model", () => {
  it("labels Anthropic from the connect screen's defaults", () => {
    const connection: Connection = { id: "anthropic", apiKey: "k" };
    expect(modelShown(connection, absent)).toEqual({
      kind: "keyed",
      provider: "anthropic",
      model: "claude-opus-5-5",
      label: "Opus 5.5",
      effort: {
        value: "medium",
        ladder: ["low", "medium", "high", "xhigh", "max"],
      },
    });
  });

  it("labels OpenAI from its default endpoint model", () => {
    const connection: Connection = { id: "openai", apiKey: "k" };
    expect(modelShown(connection, absent)).toEqual({
      kind: "keyed",
      provider: "openai",
      model: "gpt-5.1",
      label: "gpt-5.1",
      effort: null,
    });
  });
});

describe("modelShown's effort", () => {
  it("is null for an effort its ladder lacks", () => {
    const connection: Connection = {
      id: "anthropic",
      apiKey: "k",
      // Stored by an older build, or tuned on a provider whose ladder changed
      settings: {
        model: "claude-opus-5-5",
        effort: "none" as unknown as Effort,
      },
    };
    const shown = modelShown(connection, absent);
    expect(shown.kind === "keyed" && shown.effort).toBeNull();
  });

  it("is null for settings on a provider with no ladder", () => {
    const connection: Connection = {
      id: "openai",
      apiKey: "k",
      settings: { model: "gpt-5.1", effort: "high" },
    };
    const shown = modelShown(connection, absent);
    expect(shown.kind === "keyed" && shown.effort).toBeNull();
  });
});

describe("modelOptions", () => {
  it("starts with the default, then lists the keyed models", () => {
    expect(modelOptions(present)).toEqual([
      { provider: "default", model: null, label: "GLM 5.3 Flash" },
      { provider: "anthropic", model: "claude-opus-5-5", label: "Opus 5.5" },
      {
        provider: "anthropic",
        model: "claude-sonnet-5-5",
        label: "Sonnet 5.5",
      },
      {
        provider: "gemini",
        model: "gemini-3.6-flash",
        label: "Gemini 3.6 Flash",
      },
      {
        provider: "gemini",
        model: "gemini-3.1-pro-preview",
        label: "Gemini 3.1 Pro",
      },
    ]);
  });

  it("labels an unnamed default 'Default model'", () => {
    expect(modelOptions(presentUnnamed)[0]).toEqual({
      provider: "default",
      model: null,
      label: "Default model",
    });
  });

  it("has no default entry when the default is absent", () => {
    const options = modelOptions(absent);
    expect(options.some((o) => o.provider === "default")).toBe(false);
    expect(options).toHaveLength(4);
  });
});
