import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  anthropicText,
  fakeFetch,
  openAiError,
  openAiText,
  openAiToolCall,
  sse,
} from "@/shared/lib/ai/__fixtures__/fake-provider";
import { createProvider } from "./provider";
import { ModelBusyError } from "./model-busy";
import { PgAssistant, type ChatItem } from "../store";
import { PgSession } from "../../../../features/auth";
import { DEFAULT_BACKEND_URL, MAX_RESUMES, MAX_STEPS } from "../config";

// Values unlike run-turn's and createModel's fallbacks, so a provider that forgets to pass them fails
vi.mock("../config", () => ({
  MAX_STEPS: 2,
  MAX_RESUMES: 1,
  ANTHROPIC_MAX_OUTPUT_TOKENS: 64000,
  DEFAULT_BACKEND_URL: "/api/agent-under-test",
}));

vi.mock("./prompt", () => ({
  systemPrompt: () => "system",
  describeProject: () => "project",
}));

vi.mock("./tools", async () => {
  const { PgAssistant } = await import("../store");
  return {
    createTools: () => [
      {
        name: "write_file",
        description: "Write a file",
        schema: { type: "object", properties: {}, additionalProperties: false },
        run: () => {
          PgAssistant.addToolCall("wrote src/lib.rs");
          return "Wrote src/lib.rs.";
        },
      },
    ],
  };
});

const KEY = "sk-test-0123456789abcdef";

/** Answer the turn's requests in order, recording each one */
const respond = (...answers: Response[]) => {
  const { fetch, sent } = fakeFetch(...answers);
  vi.spyOn(globalThis, "fetch").mockImplementation(fetch);
  return sent;
};

const frame = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;

/** A chat-completions stream of these deltas, ending as given */
const chatStream = (deltas: Record<string, unknown>[], finish: string) =>
  sse(
    deltas
      .map((delta) =>
        frame({
          id: "chatcmpl-1",
          created: 0,
          model: "m",
          choices: [{ index: 0, delta, finish_reason: null }],
        })
      )
      .concat(
        frame({
          id: "chatcmpl-1",
          created: 0,
          model: "m",
          choices: [{ index: 0, delta: {}, finish_reason: finish }],
        }),
        "data: [DONE]\n\n"
      )
  );

/** An Anthropic stream of a thinking block followed by a text block */
const anthropicThinkingThenText = (thinking: string, text: string) =>
  sse(
    [
      {
        type: "message_start",
        message: {
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "m",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "thinking", thinking: "", signature: "" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "thinking_delta", thinking },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "signature_delta", signature: "sig" },
      },
      { type: "content_block_stop", index: 0 },
      {
        type: "content_block_start",
        index: 1,
        content_block: { type: "text", text: "" },
      },
      {
        type: "content_block_delta",
        index: 1,
        delta: { type: "text_delta", text },
      },
      { type: "content_block_stop", index: 1 },
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 1 },
      },
      { type: "message_stop" },
    ].map((event) => `event: ${event.type}\n${frame(event)}`)
  );

const defaultBackend = () => createProvider({ id: "default", apiKey: "" });
const anthropic = () => createProvider({ id: "anthropic", apiKey: KEY });

const rendered = () =>
  PgAssistant.items.map((item: ChatItem) => {
    if (item.kind === "tool") return `tool: ${item.label}`;
    if (item.kind === "assistant" || item.kind === "error") {
      return `${item.kind}: ${item.text}`;
    }
    return item.kind;
  });

const messagesOf = (body: Record<string, unknown>) =>
  body.messages as Array<Record<string, unknown>>;

beforeEach(() => PgAssistant.clear());

describe("the assistant's provider", () => {
  it("sends both system messages, then the seeded history, then the input", async () => {
    const sent = respond(openAiText("Hi again."));

    await createProvider({ id: "default", apiKey: "" }, [
      { role: "user", content: "earlier question" },
      { role: "assistant", content: "earlier answer" },
    ]).send("hi");

    expect(messagesOf(sent[0].body)).toEqual([
      { role: "system", content: "system" },
      { role: "system", content: "Current project state:\n\nproject" },
      { role: "user", content: "earlier question" },
      { role: "assistant", content: "earlier answer" },
      { role: "user", content: "hi" },
    ]);
  });

  it("asks Anthropic for droppable updates, effort, fallbacks, a cached prompt and 64000 tokens", async () => {
    const sent = respond(anthropicText("ok", "end_turn"));

    await anthropic().send("hi");

    expect(sent[0].body).toMatchObject({
      model: "claude-opus-5-5",
      max_tokens: 64000,
      thinking: {
        type: "adaptive",
        display: "updates",
        block_binding: { prefix_mismatch_behavior: "drop_block" },
      },
      output_config: { effort: "high" },
      fallbacks: "default",
      system: [
        { text: "system", cache_control: { type: "ephemeral" } },
        { text: "Current project state:\n\nproject" },
      ],
    });
    expect((sent[0].body.system as unknown[])[1]).not.toHaveProperty(
      "cache_control"
    );
    expect(sent[0].headers.get("anthropic-beta")?.split(",")).toEqual(
      expect.arrayContaining([
        "thinking-binding-controls-2026-08-01",
        "thinking-display-updates-2026-08-18",
        "server-side-fallback-2026-07-01",
      ])
    );
  });

  it("shows Anthropic's progress notes as their own paragraph", async () => {
    respond(anthropicThinkingThenText("Reading lib.rs.", "It is missing."));

    await anthropic().send("why does it fail?");

    expect(rendered()).toEqual([
      "assistant: Reading lib.rs.\n\nIt is missing.",
    ]);
  });

  it("puts the text after a tool call in a new bubble below the tool's items", async () => {
    respond(
      chatStream(
        [
          { role: "assistant", content: "Writing it." },
          {
            tool_calls: [
              {
                index: 0,
                id: "c1",
                type: "function",
                function: { name: "write_file", arguments: "{}" },
              },
            ],
          },
        ],
        "tool_calls"
      ),
      openAiText("Done.")
    );

    await defaultBackend().send("make the change");

    expect(rendered()).toEqual([
      "assistant: Writing it.",
      "tool: wrote src/lib.rs",
      "assistant: Done.",
    ]);
  });

  it("reports an empty response when the turn did nothing at all", async () => {
    respond(chatStream([], "stop"));

    await defaultBackend().send("hi");

    expect(rendered()).toEqual([
      "error: default backend returned an empty response. Try again, or pick another model.",
    ]);
  });

  it("stays quiet when a turn that ran a tool has nothing left to say", async () => {
    respond(openAiToolCall("c1", "write_file", {}), chatStream([], "stop"));

    await defaultBackend().send("make the change");

    expect(rendered()).toEqual(["tool: wrote src/lib.rs"]);
  });

  it("says so when the model is still calling tools at the step limit", async () => {
    respond(
      ...Array.from({ length: MAX_STEPS }, (_, i) =>
        openAiToolCall(`c${i}`, "write_file", {})
      )
    );

    await expect(defaultBackend().send("loop")).rejects.toThrow(
      `The model was still calling tools after ${MAX_STEPS} rounds.`
    );
  });

  it("stops resuming a paused turn after the assistant's resume limit", async () => {
    const sent = respond(
      ...Array.from({ length: MAX_RESUMES + 2 }, () =>
        anthropicText("", "pause_turn")
      )
    );

    await expect(anthropic().send("hi")).rejects.toMatchObject({
      kind: "paused",
    });
    expect(sent).toHaveLength(MAX_RESUMES + 1);
  });

  it("sends the default backend's requests to the assistant's route", async () => {
    const sent = respond(openAiText("Hi."));

    await defaultBackend().send("hi");

    expect(sent[0].url).toBe(DEFAULT_BACKEND_URL);
  });

  it("words a refusal for the user, keeping its category", async () => {
    respond(
      anthropicText("", "refusal", { type: "refusal", category: "cyber" })
    );

    await expect(anthropic().send("hi")).rejects.toThrow(
      "The model declined this request (cyber). Rephrase it, or switch backends."
    );
  });

  it("does not send a failed turn's input with the next turn", async () => {
    const sent = respond(
      anthropicText("", "refusal", { type: "refusal", category: "cyber" }),
      anthropicText("ok", "end_turn")
    );
    const provider = anthropic();

    await provider.send("refused question").catch(() => undefined);
    await provider.send("new question");

    expect(JSON.stringify(sent[1].body.messages)).not.toContain(
      "refused question"
    );
  });

  it("leaves the key out of a provider error that quotes it", async () => {
    respond(openAiError(401, `Incorrect API key provided: ${KEY}`));
    const provider = createProvider({
      id: "openai",
      apiKey: KEY,
      endpoint: { baseUrl: "https://llm.test/v1", model: "m" },
    });

    const failure = await provider.send("hi").catch((e: Error) => e.message);

    // Spec 08's AI-05: the provider's words stay in the log
    expect(failure).toBe(
      "The model's provider did not accept this key. Check it in Settings, or use the hosted model."
    );
    expect(failure).not.toContain(KEY);
  });

  describe("a model limiting requests", () => {
    it("is busy, with no HTTP status, from a provider's own error", async () => {
      respond(openAiError(429, "Rate limit reached for gpt-4o"));
      const provider = createProvider({
        id: "openai",
        apiKey: KEY,
        endpoint: { baseUrl: "https://llm.test/v1", model: "m" },
      });

      const failure = await provider.send("hi").catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(ModelBusyError);
      expect((failure as ModelBusyError).message).toBe("The model is busy.");
    });

    it("carries the default backend's wait in seconds", async () => {
      respond(
        new Response(JSON.stringify({ error: "Upstream 429: slow down" }), {
          status: 429,
          statusText: "Too Many Requests",
          headers: { "content-type": "application/json", "retry-after": "12" },
        })
      );

      const failure = await defaultBackend()
        .send("hi")
        .catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(ModelBusyError);
      expect((failure as ModelBusyError).waitSeconds).toBe(12);
    });

    it("is not busy once a tool has run, so the turn is not sent again", async () => {
      respond(
        openAiToolCall("c1", "write_file", {}),
        new Response(JSON.stringify({ error: "Upstream 429: slow down" }), {
          status: 429,
          statusText: "Too Many Requests",
          headers: { "content-type": "application/json" },
        })
      );

      const failure = await defaultBackend()
        .send("make the change")
        .catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(ModelBusyError);
      expect((failure as Error).message).toMatch(/already ran/);
    });
  });

  it("never shows the default backend's relay of an upstream failure", async () => {
    respond(
      new Response(
        JSON.stringify({ error: 'Upstream 503: {"error":"overloaded"}' }),
        {
          status: 503,
          statusText: "Service Unavailable",
          headers: { "content-type": "application/json" },
        }
      )
    );

    await expect(defaultBackend().send("hi")).rejects.toThrow(
      /^Could not get an answer from the model\. Send your message again\.$/
    );
  });

  it("shows the default backend's sentence for a failure it refuses", async () => {
    const sentence =
      "Sign-in is not configured on this deployment, so its default backend is off.";
    respond(
      new Response(JSON.stringify({ error: sentence }), {
        status: 503,
        statusText: "Service Unavailable",
        headers: { "content-type": "application/json" },
      })
    );

    // Its own refusal, written for people: shown whole, with no status
    await expect(defaultBackend().send("hi")).rejects.toThrow(
      new Error(sentence)
    );
  });

  it("echoes Gemini's thought signature on its tool call in the next turn", async () => {
    const extra = { google: { thought_signature: "sig-1" } };
    const sent = respond(
      chatStream(
        [
          {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "c1",
                type: "function",
                function: { name: "write_file", arguments: "{}" },
                extra_content: extra,
              },
            ],
          },
        ],
        "tool_calls"
      ),
      openAiText("Done."),
      openAiText("Sure.")
    );
    const provider = createProvider({ id: "gemini", apiKey: KEY });

    await provider.send("write it");
    await provider.send("thanks");

    const assistant = messagesOf(sent[2].body).find(
      (m) => m.role === "assistant"
    );
    expect(assistant?.tool_calls).toEqual([
      expect.objectContaining({ id: "c1", extra_content: extra }),
    ]);
  });

  it("runs every tool call of a chunk that gives them no index", async () => {
    const call = (id: string) => ({
      id,
      type: "function",
      function: { name: "write_file", arguments: "{}" },
    });
    const sent = respond(
      chatStream(
        [
          { role: "assistant", tool_calls: [call("c1")] },
          { tool_calls: [call("c2")] },
        ],
        "tool_calls"
      ),
      openAiText("Done.")
    );

    await createProvider({ id: "gemini", apiKey: KEY }).send("write both");

    const results = messagesOf(sent[1].body).filter((m) => m.role === "tool");
    expect(results.map((m) => m.tool_call_id)).toEqual(["c1", "c2"]);
  });

  describe("a signed-out refusal", () => {
    const refusal = "Sign in with GitHub to use the default backend.";

    const unauthorized = (body: Record<string, unknown>) =>
      new Response(JSON.stringify(body), {
        status: 401,
        statusText: "Unauthorized",
        headers: { "content-type": "application/json" },
      });

    beforeEach(() => {
      vi.spyOn(PgSession, "refresh").mockResolvedValue();
    });

    afterEach(() => vi.restoreAllMocks());

    it("shows the default backend's refusal as its own sentence", async () => {
      respond(unauthorized({ error: refusal, reason: "signed-out" }));

      await expect(defaultBackend().send("hi")).rejects.toThrow(
        new RegExp(`^${refusal}$`)
      );
    });

    // The browser still thought it was signed in, so the panel hid sign-in
    it("re-reads the session, so the panel offers sign-in again", async () => {
      respond(unauthorized({ error: refusal, reason: "signed-out" }));

      await defaultBackend()
        .send("hi")
        .catch(() => undefined);

      expect(PgSession.refresh).toHaveBeenCalled();
    });

    it.each([
      {
        name: "another endpoint's 401 in the same shape",
        provider: () =>
          createProvider({
            id: "openai",
            apiKey: KEY,
            endpoint: { baseUrl: "https://llm.test/v1", model: "m" },
          }),
        body: { error: refusal, reason: "signed-out" },
      },
      {
        name: "the default backend's 401 for another reason",
        provider: defaultBackend,
        body: { error: refusal, reason: "other" },
      },
    ])("keeps the SDK's message for $name", async ({ provider, body }) => {
      respond(unauthorized(body));

      const failure = await provider()
        .send("hi")
        .catch((e: Error) => e.message);

      expect(failure).not.toBe(refusal);
      expect(PgSession.refresh).not.toHaveBeenCalled();
    });
  });
});
