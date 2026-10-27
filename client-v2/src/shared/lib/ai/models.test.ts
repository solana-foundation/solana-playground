import { describe, expect, it, vi } from "vitest";
import type { ModelMessage } from "ai";

import {
  anthropicText,
  fakeFetch,
  openAiText,
  openAiToolCall,
} from "./__fixtures__/fake-provider";
import { createModel } from "./models";
import { runTurn } from "./run-turn";
import { toSdkTools } from "./tools";
import type { ModelConnection } from "./types";

const KEY = "test-key-0123456789";
const USER: ModelMessage[] = [{ role: "user", content: "hello" }];

describe("createModel", () => {
  interface Row {
    name: string;
    connection: ModelConnection;
    url: string;
    headers: Record<string, string | null>;
  }

  it.each<Row>([
    {
      name: "anthropic",
      connection: {
        provider: "anthropic",
        apiKey: KEY,
        model: "m",
      },
      url: "https://api.anthropic.com/v1/messages",
      headers: {
        "x-api-key": KEY,
        "anthropic-dangerous-direct-browser-access": "true",
        authorization: null,
      },
    },
    {
      name: "openai",
      connection: {
        provider: "openai",
        apiKey: KEY,
        baseUrl: "https://api.openai.com/v1",
        model: "m",
      },
      url: "https://api.openai.com/v1/chat/completions",
      headers: { authorization: `Bearer ${KEY}`, "x-api-key": null },
    },
    {
      name: "gemini",
      connection: {
        provider: "gemini",
        apiKey: KEY,
        baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
        model: "m",
      },
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      headers: { authorization: `Bearer ${KEY}`, "x-api-key": null },
    },
    {
      name: "openrouter",
      connection: {
        provider: "openrouter",
        apiKey: KEY,
        baseUrl: "https://openrouter.ai/api/v1",
        model: "m",
      },
      url: "https://openrouter.ai/api/v1/chat/completions",
      headers: { authorization: `Bearer ${KEY}`, "x-api-key": null },
    },
    {
      name: "openai with an empty key",
      connection: {
        provider: "openai",
        apiKey: "",
        baseUrl: "http://localhost:4000/v1",
        model: "m",
      },
      url: "http://localhost:4000/v1/chat/completions",
      headers: { authorization: null },
    },
  ])(
    "sends $name to its endpoint with its auth header",
    async ({ name, connection, url, headers }: Row) => {
      const { fetch, sent } = fakeFetch(
        name === "anthropic"
          ? anthropicText("hi", "end_turn")
          : openAiText("hi")
      );
      vi.spyOn(globalThis, "fetch").mockImplementation(fetch);

      await runTurn({ model: createModel(connection), messages: USER });

      expect(sent[0].url).toBe(url);
      for (const [header, value] of Object.entries(headers)) {
        expect(sent[0].headers.get(header)).toBe(value);
      }
    }
  );

  it.each([
    { name: "its url", url: "/api/other", expected: "/api/other" },
    {
      name: "/api/agent without a url",
      url: undefined,
      expected: "/api/agent",
    },
  ])(
    "sends every default-backend request to $name with no key",
    async ({ url, expected }) => {
      const { fetch, sent } = fakeFetch(
        openAiToolCall("c1", "ping", {}),
        openAiText("pong")
      );
      vi.spyOn(globalThis, "fetch").mockImplementation(fetch);

      await runTurn({
        model: createModel({ provider: "default", url }),
        messages: USER,
        tools: toSdkTools([
          {
            name: "ping",
            description: "Ping",
            schema: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
            run: () => "pong",
          },
        ]),
      });

      expect(sent.map((request) => request.url)).toEqual([expected, expected]);
      for (const request of sent) {
        expect(request.headers.get("authorization")).toBeNull();
        expect(request.headers.get("x-api-key")).toBeNull();
      }
    }
  );
});
