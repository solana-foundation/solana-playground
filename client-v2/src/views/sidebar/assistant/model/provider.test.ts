import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";

import {
  DAILY_CAP_REASON,
  POOL_EXHAUSTED_REASON,
  REFUSAL_MESSAGES,
} from "@/features/agent";
import { toReplayMessagesWith } from "@/features/persistence";
import {
  decodeThread,
  encodeThread,
  mergeThreads,
} from "@/features/persistence/model/chat-codec";
import { PgChatStorage } from "@/features/persistence/model/chat-storage";
import {
  anthropicText,
  fakeFetch,
  openAiError,
  openAiText,
  openAiToolCall,
  sse,
} from "@/shared/lib/ai/__fixtures__/fake-provider";
import {
  initLogger,
  memoryProvider as memoryLog,
  resetLogger,
} from "@/shared/lib/logger";
import {
  initTelemetry,
  memoryProvider,
  resetTelemetry,
} from "@/shared/lib/telemetry";

import { PgSession } from "../../../../features/auth";
import { DEFAULT_BACKEND_URL, MAX_RESUMES, MAX_STEPS } from "../config";
import { type ChatItem, isToolCallRecord, PgAssistant } from "../store";
import { ModelBusyError } from "./model-busy";
import { MODEL_PROVIDER_PROFILES } from "./model-providers";
import { createProvider } from "./provider";
import { TurnFailure } from "./types";

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

/** Holds the `slow` tool until a test lets it finish */
const slow = vi.hoisted(() => {
  let release = () => {};
  let started = () => {};
  return {
    started: new Promise<void>((resolve) => (started = resolve)),
    reset() {
      this.started = new Promise<void>((resolve) => (started = resolve));
    },
    run: () =>
      new Promise<string>((resolve) => {
        release = () => resolve("Done slowly.");
        started();
      }),
    release: () => release(),
  };
});

vi.mock("./tools", async () => {
  const { PgAssistant: assistant } = await import("../store");
  return {
    createTools: () => [
      {
        name: "slow",
        description: "Takes a while",
        schema: { type: "object", properties: {}, additionalProperties: false },
        run: () => slow.run(),
      },
      {
        name: "write_file",
        description: "Write a file",
        schema: { type: "object", properties: {}, additionalProperties: false },
        run: () => {
          assistant.addToolCall("wrote src/lib.rs");
          return "Wrote src/lib.rs.";
        },
      },
    ],
  };
});

const KEY = "sk-test-0123456789abcdef";

/** Answer the turn's requests in order, recording each one */
const respond = (...answers: Parameters<typeof fakeFetch>) => {
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

/** What the thread draws: a stored call is for the replay, not the thread */
const rendered = () =>
  PgAssistant.items
    .filter((item) => !isToolCallRecord(item))
    .map((item: ChatItem) => {
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

  describe("tool calls kept in the history", () => {
    /** A turn that calls write_file once, then answers */
    const writeTurn = () =>
      respond(
        chatStream(
          [
            {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: "sdk-id-1",
                  type: "function",
                  function: {
                    name: "write_file",
                    arguments: '{"path":"src/lib.rs"}',
                  },
                },
              ],
            },
          ],
          "tool_calls"
        ),
        openAiText("Done.")
      );

    const toolMessages = (body: Record<string, unknown>) =>
      messagesOf(body).filter(
        (m) => m.role === "tool" || (m.role === "assistant" && m.tool_calls)
      );

    it("stores the tool's result after the tool's own marker", async () => {
      writeTurn();

      await defaultBackend().send("make the change");

      expect(
        PgAssistant.items.map((item) =>
          isToolCallRecord(item)
            ? `call: ${item.call.name} -> ${item.call.output}`
            : item.kind
        )
      ).toEqual(["tool", "call: write_file -> Wrote src/lib.rs.", "assistant"]);
      expect(rendered()).toEqual([
        "tool: wrote src/lib.rs",
        "assistant: Done.",
      ]);
    });

    it("replays a stored call to Anthropic as tool_use and tool_result", async () => {
      PgAssistant.addToolResult(
        {
          toolName: "read_file",
          input: { path: "src/lib.rs" },
          output: "Not found",
          failed: true,
        },
        undefined
      );
      const asked: ChatItem = {
        id: "u-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        kind: "user",
        text: "read lib.rs",
      };
      const seed = toReplayMessagesWith(() => true)(
        Array.of<ChatItem>(asked).concat(PgAssistant.items)
      );
      const sent = respond(anthropicText("It is missing.", "end_turn"));

      await createProvider({ id: "anthropic", apiKey: KEY }, seed).send("why?");

      expect(messagesOf(sent[0].body).slice(0, 3)).toEqual([
        { role: "user", content: [{ type: "text", text: "read lib.rs" }] },
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "call_1",
              name: "read_file",
              input: { path: "src/lib.rs" },
            },
          ],
        },
        {
          role: "user",
          content: [
            expect.objectContaining({
              type: "tool_result",
              tool_use_id: "call_1",
              is_error: true,
            }),
            expect.objectContaining({ type: "text", text: "why?" }),
          ],
        },
      ]);
    });

    it.each([
      ["stopped", () => PgAssistant.stopTurn()],
      ["its thread closed", () => PgAssistant.closeThread()],
    ])(
      "stores no call whose turn was %s while the tool ran",
      async (_, cut) => {
        slow.reset();
        respond(openAiToolCall("c1", "slow", {}), openAiText("Late."));
        // Closing cuts the turn only while a thread is open, as in the panel
        await PgAssistant.loadThread("slow-turn");
        const turn = new AbortController();
        PgAssistant.beginTurn(turn);

        const sent = defaultBackend().send("go slowly", {
          signal: turn.signal,
        });
        await slow.started;
        cut();
        slow.release();
        await sent.catch(() => undefined);
        PgAssistant.endTurn(turn);

        expect(PgAssistant.items.filter(isToolCallRecord)).toEqual([]);
        PgAssistant.closeThread();
      }
    );

    it("survives storage and a pull from another device, and goes with the next request", async () => {
      writeTurn();
      // The panel adds the message before the turn (`use-turn`)
      PgAssistant.addUserMessage("make the change");
      await defaultBackend().send("make the change");
      vi.restoreAllMocks();

      // This device's storage, then the account's copy as another device reads it
      await PgChatStorage.write("round-trip", PgAssistant.items);
      const local = (await PgChatStorage.read("round-trip")) ?? [];
      const pulled = decodeThread(
        JSON.parse(JSON.stringify(encodeThread(local)))
      );
      const thread = mergeThreads([], pulled);

      const sent = respond(openAiText("It is written."));
      await createProvider(
        { id: "default", apiKey: "" },
        toReplayMessagesWith(() => true)(thread)
      ).send("is it written?");

      expect(toolMessages(sent[0].body)).toEqual([
        {
          role: "assistant",
          // eslint-disable-next-line unicorn/no-null -- the OpenAI-compatible body: a call-only message has `content: null`
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: "write_file",
                arguments: '{"path":"src/lib.rs"}',
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_1",
          content: "Wrote src/lib.rs.",
        },
      ]);
    });
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
      reason: "paused",
    });
    expect(sent).toHaveLength(MAX_RESUMES + 1);
  });

  describe("A profile that declares no tool support", () => {
    afterEach(() => {
      MODEL_PROVIDER_PROFILES.openai.supportsTools = true;
    });

    it.each([
      // Every tool the mocked `createTools` builds
      [true, ["slow", "write_file"]],
      [false, undefined],
    ])(
      "with supportsTools %s, the request declares tools %j",
      async (supportsTools, declared) => {
        MODEL_PROVIDER_PROFILES.openai.supportsTools = supportsTools;
        const sent = respond(openAiText("Hi."));

        await createProvider({
          id: "openai",
          apiKey: KEY,
          endpoint: { baseUrl: "https://llm.test/v1", model: "m" },
        }).send("hi");

        const tools = sent[0].body.tools as
          | Array<{ function: { name: string } }>
          | undefined;
        expect(tools?.map((tool) => tool.function.name)).toEqual(declared);
      }
    );
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

  describe("an outage", () => {
    let entries: ReturnType<typeof memoryLog>["entries"];

    beforeEach(() => {
      const memory = memoryLog();
      entries = memory.entries;
      initLogger({ providers: [memory] });
    });

    afterEach(() => resetLogger());

    const reported = () => entries.filter((entry) => entry.report);

    it("of the default backend is reported: it is ours", async () => {
      respond(
        new Response(
          JSON.stringify({
            error: "The default backend's key was refused upstream (401).",
          }),
          {
            status: 502,
            statusText: "Bad Gateway",
            headers: { "content-type": "application/json" },
          }
        )
      );

      await defaultBackend()
        .send("hi")
        .catch((e: unknown) => e);

      expect(reported()).toHaveLength(1);
    });

    it("is not reported for the default backend's own refusal", async () => {
      respond(
        new Response(
          JSON.stringify({ error: "Sign-in is unavailable right now." }),
          {
            status: 503,
            statusText: "Service Unavailable",
            headers: { "content-type": "application/json" },
          }
        )
      );

      await defaultBackend()
        .send("hi")
        .catch((e: unknown) => e);

      expect(reported()).toEqual([]);
    });

    it("of the default backend with nothing to stream is reported", async () => {
      respond(
        new Response(
          JSON.stringify({ error: "Upstream 200 with no body to stream." }),
          {
            status: 502,
            statusText: "Bad Gateway",
            headers: { "content-type": "application/json" },
          }
        )
      );

      await defaultBackend()
        .send("hi")
        .catch((e: unknown) => e);

      expect(reported()).toHaveLength(1);
    });

    it("relayed by the default backend from its upstream is not reported", async () => {
      respond(
        new Response(
          JSON.stringify({
            error: 'Upstream 529: {"type":"overloaded_error"}',
          }),
          {
            status: 529,
            headers: { "content-type": "application/json" },
          }
        )
      );

      await defaultBackend()
        .send("hi")
        .catch((e: unknown) => e);

      expect(reported()).toEqual([]);
    });

    it("of a third-party provider is not reported", async () => {
      respond(openAiError(503, "overloaded"));
      const provider = createProvider({
        id: "openai",
        apiKey: KEY,
        endpoint: { baseUrl: "https://llm.test/v1", model: "m" },
      });

      await provider.send("hi").catch((e: unknown) => e);

      expect(reported()).toEqual([]);
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
    await expect(defaultBackend().send("hi")).rejects.toMatchObject({
      name: "TurnFailure",
      message: sentence,
      reason: "provider",
    });
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

    it("is the provider's own 401 to telemetry, with the refusal as its text", async () => {
      respond(unauthorized({ error: refusal, reason: "signed-out" }));

      const failure = await defaultBackend()
        .send("hi")
        .catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(TurnFailure);
      expect(failure).toMatchObject({
        reason: "provider",
        status: 401,
        message: refusal,
      });
    });
  });

  describe("a refusal by a limit of the default backend", () => {
    let tracked: ReturnType<typeof memoryProvider>;

    beforeEach(() => {
      tracked = memoryProvider();
      initTelemetry({ providers: [tracked] });
      vi.spyOn(PgSession, "refresh").mockResolvedValue();
    });

    afterEach(() => {
      resetTelemetry();
      vi.restoreAllMocks();
    });

    /** `/api/agent` answers `status` with `body` */
    const refuses = (status: number, body: Record<string, unknown>) =>
      respond(
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        })
      );

    const refused = () =>
      tracked.events.filter((event) => event.name === "agent_refused");

    it("shows the daily-cap sentence, tracks it once, and keeps the conversation and session", async () => {
      PgAssistant.addUserMessage("earlier");
      refuses(429, {
        error: "server text",
        reason: "daily-cap",
        tier: "newcomer",
      });

      await expect(defaultBackend().send("hi")).rejects.toThrow(
        /^You have used today's free assistant allowance\. It resets at 00:00 UTC, or bring your own key to keep going\.$/
      );
      expect(refused()).toEqual([
        {
          name: "agent_refused",
          params: { reason: "daily-cap", tier: "newcomer" },
        },
      ]);
      expect(
        PgAssistant.items.some(
          (item) => item.kind === "user" && item.text === "earlier"
        )
      ).toBe(true);
      // Ending it would reopen the picker on sign-in, not on the backends
      expect(PgSession.refresh).not.toHaveBeenCalled();
    });

    it("shows the pool-exhausted sentence and tracks it once", async () => {
      // A cap of ours, not an outage: the team does not hear of each one
      const log = memoryLog();
      initLogger({ providers: [log] });
      onTestFinished(() => resetLogger());
      refuses(503, {
        error: "server text",
        reason: "pool-exhausted",
        tier: "established",
      });

      await expect(defaultBackend().send("hi")).rejects.toThrow(
        /^The free assistant is out of capacity for today\. It resets at 00:00 UTC, or bring your own key to keep going\.$/
      );
      expect(refused()).toEqual([
        {
          name: "agent_refused",
          params: { reason: "pool-exhausted", tier: "established" },
        },
      ]);
      expect(log.entries.filter((entry) => entry.report)).toEqual([]);
    });

    it("tracks a refusal without a tier as unknown", async () => {
      refuses(429, { reason: "daily-cap" });

      await expect(defaultBackend().send("hi")).rejects.toThrow(
        /^You have used today's free assistant allowance\./
      );

      expect(refused()).toEqual([
        {
          name: "agent_refused",
          params: { reason: "daily-cap", tier: "unknown" },
        },
      ]);
    });

    it("tracks nothing for a signed-out refusal", async () => {
      refuses(401, { error: "Sign in.", reason: "signed-out" });

      await expect(defaultBackend().send("hi")).rejects.toThrow(/^Sign in\.$/);

      expect(refused()).toEqual([]);
    });

    it("reads another backend's 429 in the same shape as busy, not as a cap", async () => {
      refuses(429, { error: "server text", reason: "daily-cap" });
      const ownKey = createProvider({
        id: "openai",
        apiKey: KEY,
        endpoint: { baseUrl: "https://llm.test/v1", model: "m" },
      });

      const failure = await ownKey.send("hi").catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(ModelBusyError);
      expect(refused()).toEqual([]);
    });

    it("does not read a reason sent with the other limit's status", async () => {
      refuses(503, { reason: "daily-cap", tier: "newcomer" });

      const failure = await defaultBackend()
        .send("hi")
        .catch((e: Error) => e.message);

      expect(failure).toBe(
        "Could not get an answer from the model. Send your message again."
      );
      expect(refused()).toEqual([]);
    });
  });
});

describe("a turn's failure", () => {
  const json = { "content-type": "application/json" };
  const refusal = () =>
    anthropicText("", "refusal", { type: "refusal", category: "cyber" });
  const paused = () =>
    Array.from({ length: MAX_RESUMES + 2 }, () =>
      anthropicText("", "pause_turn")
    );
  /** `/api/agent` refuses with `status` and `body` */
  const refuses = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: json });

  beforeEach(() => initTelemetry({ providers: [memoryProvider()] }));
  afterEach(() => resetTelemetry());

  it.each([
    {
      name: "a backend error, with its status",
      provider: defaultBackend,
      answers: () => [openAiError(500, "boom")],
      reason: "provider",
      status: 500,
      // Spec 08's words, never the backend's text
      message:
        /^Could not get an answer from the model\. Send your message again\.$/,
    },
    {
      name: "a refusal, with no status",
      provider: anthropic,
      answers: () => [refusal()],
      reason: "refusal",
      status: undefined,
      message: /Rephrase it, or switch backends\.$/,
    },
    {
      name: "a turn that kept pausing, with no status",
      provider: anthropic,
      answers: paused,
      reason: "paused",
      status: undefined,
      message: new RegExp(
        `^The turn paused ${MAX_RESUMES + 1} times without finishing\\.$`
      ),
    },
    {
      name: "a backend that did not answer, with no status",
      provider: defaultBackend,
      answers: () => [
        () => {
          throw new TypeError("Failed to fetch");
        },
      ],
      reason: "provider",
      status: undefined,
      message: /Failed to fetch/,
    },
    {
      // The panel's own sentence for the limit, not the SDK's wrapper around the status
      name: "the daily cap, as capped with the 429",
      provider: defaultBackend,
      answers: () => [
        refuses(429, { reason: DAILY_CAP_REASON, tier: "newcomer" }),
      ],
      reason: "capped",
      status: 429,
      message: new RegExp(`^${REFUSAL_MESSAGES[DAILY_CAP_REASON]}$`),
    },
    {
      name: "an exhausted pool, as capped with the 503",
      provider: defaultBackend,
      answers: () => [
        // `error` as the route sends it, so the cap is read before the 503's own sentence
        refuses(503, {
          error: "server text",
          reason: POOL_EXHAUSTED_REASON,
          tier: "established",
        }),
      ],
      reason: "capped",
      status: 503,
      message: new RegExp(`^${REFUSAL_MESSAGES[POOL_EXHAUSTED_REASON]}$`),
    },
    {
      // Relayed by the default backend with the upstream's own status and no `reason`
      name: "an upstream rate limit, as the provider's 429 and not a cap",
      provider: defaultBackend,
      answers: () => [openAiError(429, "Rate limited")],
      reason: "provider",
      status: 429,
      message: /^The model is busy\./,
    },
  ])(
    "rejects with $name",
    async ({ provider, answers, reason, status, message }) => {
      respond(...answers());

      const failure = await provider()
        .send("hi")
        .catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(TurnFailure);
      expect(failure).toMatchObject({ reason, status });
      expect((failure as Error).message).toMatch(message);
      // The SDK's error travels with it, for a log
      expect((failure as Error).cause).toMatchObject({ name: "AiTurnError" });
    }
  );

  it("passes a failure raised on this side through unchanged", async () => {
    respond(
      ...Array.from({ length: MAX_STEPS }, (_, i) =>
        openAiToolCall(`c${i}`, "write_file", {})
      )
    );

    const failure = await defaultBackend()
      .send("loop")
      .catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(TurnFailure);
  });
});
