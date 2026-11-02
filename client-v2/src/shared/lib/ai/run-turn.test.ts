import { it } from "vitest";
import {
  anthropicText,
  fakeFetch,
  openAiError,
  openAiText,
  openAiToolCall,
  sse,
} from "./__fixtures__/fake-provider";
import { initLogger, memoryProvider, resetLogger } from "../logger";
import type { LogEntry } from "../logger";
import { createModel } from "./models";
import { AiTurnError, runTurn } from "./run-turn";
import { toSdkTools } from "./tools";
import type { ModelMessage } from "ai";

const USER: ModelMessage[] = [{ role: "user", content: "hello" }];

const openAi = (fetch: typeof globalThis.fetch) =>
  createModel({
    provider: "openai",
    apiKey: "test-key",
    baseUrl: "https://llm.test/v1",
    model: "m",
    fetch,
  });

const anthropic = (fetch: typeof globalThis.fetch) =>
  createModel({ provider: "anthropic", apiKey: "test-key", model: "m", fetch });

const echo = toSdkTools([
  {
    name: "echo",
    description: "Echo",
    schema: { type: "object", properties: {}, additionalProperties: false },
    run: () => "echoed",
  },
]);

describe("runTurn", () => {
  it("sends no request past the step limit while the model keeps calling tools", async () => {
    const { fetch, sent } = fakeFetch(
      openAiToolCall("c1", "echo", {}),
      openAiToolCall("c2", "echo", {}),
      openAiToolCall("c3", "echo", {}),
      openAiToolCall("c4", "echo", {})
    );

    const result = await runTurn({
      model: openAi(fetch),
      messages: USER,
      tools: echo,
      maxSteps: 3,
    });

    expect(sent).toHaveLength(3);
    expect(result.reachedStepLimit).toBe(true);
  });

  it("resumes a paused turn with the paused content", async () => {
    const { fetch, sent } = fakeFetch(
      anthropicText("one", "pause_turn"),
      anthropicText("two", "end_turn")
    );
    let text = "";

    await runTurn({
      model: anthropic(fetch),
      messages: USER,
      onText: (delta) => (text += delta),
    });

    expect(sent).toHaveLength(2);
    expect((sent[1].body.messages as unknown[]).at(-1)).toEqual({
      role: "assistant",
      content: [{ type: "text", text: "one" }],
    });
    expect(text).toBe("onetwo");
  });

  it("rejects a turn that keeps pausing once resumes run out", async () => {
    const { fetch, sent } = fakeFetch(
      anthropicText("a", "pause_turn"),
      anthropicText("b", "pause_turn"),
      anthropicText("c", "pause_turn"),
      anthropicText("d", "pause_turn")
    );

    const turn = runTurn({
      model: anthropic(fetch),
      messages: USER,
      maxResumes: 2,
    });

    await expect(turn).rejects.toThrow(AiTurnError);
    await expect(turn).rejects.toThrow(/paused/);
    await expect(turn).rejects.toMatchObject({ kind: "paused" });
    expect(sent).toHaveLength(3);
  });

  it("sends a request answered with 429 once", async () => {
    const { fetch, sent } = fakeFetch(
      openAiError(429, "slow down"),
      openAiError(429, "slow down")
    );

    const turn = runTurn({ model: openAi(fetch), messages: USER });

    await expect(turn).rejects.toMatchObject({
      name: "AiTurnError",
      status: 429,
    });
    expect(sent).toHaveLength(1);
  });

  it("keeps a failed response's body, without the key", async () => {
    const { fetch } = fakeFetch(openAiError(401, "bad key test-key"));

    const failure = await runTurn({
      model: openAi(fetch),
      messages: USER,
      apiKey: "test-key",
    }).catch((e: AiTurnError) => e);

    expect(failure).toBeInstanceOf(AiTurnError);
    expect((failure as AiTurnError).body).toContain("bad key [your key]");
  });

  it("never logs a failed response's key to the console", async () => {
    const { fetch } = fakeFetch(openAiError(401, "bad key test-key"));
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await runTurn({
      model: openAi(fetch),
      messages: USER,
      apiKey: "test-key",
    }).catch((e: unknown) => e);

    const logged = consoleError.mock.calls.flat().map((arg) => {
      if (arg instanceof Error) return `${arg.message} ${JSON.stringify(arg)}`;
      return typeof arg === "string" ? arg : JSON.stringify(arg);
    });
    consoleError.mockRestore();
    expect(logged.filter((line) => line.includes("test-key"))).toEqual([]);
  });

  describe("a failed request reads as Spec 08 words, never its status or body", () => {
    let entries: LogEntry[];

    beforeEach(() => {
      const memory = memoryProvider();
      entries = memory.entries;
      initLogger({ providers: [memory] });
    });

    afterEach(() => resetLogger());

    const failOn = async (response: Response | (() => Response)) => {
      const { fetch } = fakeFetch(response);
      return (await runTurn({
        model: openAi(fetch),
        messages: USER,
        apiKey: "test-key-123",
      }).catch((e: unknown) => e)) as AiTurnError;
    };

    const reported = () => entries.filter((entry) => entry.report);

    it("keeps the status and the redacted body in the detail, not the message", async () => {
      const failure = await failOn(
        new Response(
          JSON.stringify({ error: "Upstream 500: test-key-123 was not used." }),
          { status: 502, statusText: "Bad Gateway" }
        )
      );

      expect(failure).toBeInstanceOf(AiTurnError);
      expect(failure.kind).toBe("provider");
      expect(failure.message).toBe(
        "Could not get an answer from the model. Send your message again."
      );
      expect(failure.detail).toBe(
        '502 Bad Gateway — {"error":"Upstream 500: [your key] was not used."}'
      );
      // An outage: the provider's status page says so, and a resend repeats it
      expect(reported()).toEqual([]);
    });

    it("a server error that is not an outage is reported", async () => {
      const failure = await failOn(openAiError(500, "internal error"));

      expect(failure.kind).toBe("provider");
      expect(reported()).toHaveLength(1);
    });

    it.each([
      [404, "The model gpt-9 does not exist", "no-model"],
      [403, "This key has no access to the model", "forbidden"],
      [413, "Request too large", "too-long"],
      [400, "prompt is too long: 210000 tokens > 200000 maximum", "too-long"],
      [401, "Incorrect API key provided: test-key-123", "key-refused"],
      [429, "Rate limit reached", "busy"],
    ])(
      "a %i (%s) is %s: no resend, nothing reported",
      async (status, said, kind) => {
        const failure = await failOn(openAiError(status, said));

        expect(failure.kind).toBe(kind);
        expect(failure.status).toBe(status);
        expect(failure.message).not.toMatch(/Send your message again/);
        expect(failure.message).not.toContain(String(status));
        expect(failure.detail).toContain(
          said.replace("test-key-123", "[your key]")
        );
        expect(reported()).toEqual([]);
      }
    );

    it("Gemini's 400 for a bad key is key-refused", async () => {
      const failure = await failOn(
        new Response(
          JSON.stringify({
            error: {
              code: 400,
              message: "API key not valid. Please pass a valid API key.",
              status: "INVALID_ARGUMENT",
              details: [{ reason: "API_KEY_INVALID" }],
            },
          }),
          { status: 400, headers: { "content-type": "application/json" } }
        )
      );

      expect(failure.kind).toBe("key-refused");
      expect(reported()).toEqual([]);
    });

    it("a 400 the provider could not read is reported, and not resent", async () => {
      const failure = await failOn(openAiError(400, "Invalid 'messages[0]'"));

      expect(failure.kind).toBe("invalid");
      expect(failure.message).not.toMatch(/Send your message again/);
      expect(reported()).toHaveLength(1);
    });

    it("a programming error is reported, its text kept off screen", async () => {
      const failure = await failOn(() => {
        throw new TypeError("x.fetch is not a function");
      });

      expect(failure.kind).toBe("provider");
      expect(failure.message).not.toContain("x.fetch");
      expect(failure.detail).toContain("x.fetch is not a function");
      expect(reported()).toHaveLength(1);
    });

    it("a 429 is busy, with the server's wait in seconds", async () => {
      const failure = await failOn(
        new Response(JSON.stringify({ error: "Upstream 429: slow down" }), {
          status: 429,
          statusText: "Too Many Requests",
          headers: { "retry-after": "7" },
        })
      );

      expect(failure.kind).toBe("busy");
      expect(failure.message).toBe("The model is busy.");
      expect(failure.retryAfter).toBe(7);
    });

    it("a 429 with no wait leaves the wait to the caller", async () => {
      const failure = await failOn(openAiError(429, "Rate limit reached"));

      expect(failure.kind).toBe("busy");
      expect(failure.retryAfter).toBeUndefined();
      expect(failure.detail).toContain("Rate limit reached");
    });
  });

  it("rejects with the abort reason mid-stream and sends nothing more", async () => {
    const encoder = new TextEncoder();
    const hanging = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  id: "1",
                  created: 0,
                  model: "m",
                  choices: [
                    {
                      index: 0,
                      delta: { content: "part" },
                      finish_reason: null,
                    },
                  ],
                })}\n\n`
              )
            );
          },
        }),
        { headers: { "content-type": "text/event-stream" } }
      );
    const { fetch, sent } = fakeFetch(hanging, openAiText("again"));
    const controller = new AbortController();
    const reason = new Error("stopped by the user");

    const turn = runTurn({
      model: openAi(fetch),
      messages: USER,
      signal: controller.signal,
      onText: () => controller.abort(reason),
    });

    await expect(turn).rejects.toBe(reason);
    expect(sent).toHaveLength(1);
  });

  it("rejects on an error frame cut across two chunks", async () => {
    const errorFrame = `data: ${JSON.stringify({
      error: { message: "overloaded", type: "overloaded_error" },
    })}\n\n`;
    const { fetch } = fakeFetch(
      sse([
        `data: ${JSON.stringify({
          id: "1",
          created: 0,
          model: "m",
          choices: [{ index: 0, delta: { content: "partial" } }],
        })}\n\n`,
        errorFrame.slice(0, 20),
        errorFrame.slice(20),
      ])
    );

    const turn = runTurn({ model: openAi(fetch), messages: USER });

    // Spec 08's words on screen; the provider's own, "overloaded", in the detail
    const failure = (await turn.catch((e: unknown) => e)) as AiTurnError;
    expect(failure).toBeInstanceOf(AiTurnError);
    expect(failure.message).toBe(
      "Could not get an answer from the model. Send your message again."
    );
    expect(failure.detail).toMatch(/overloaded/);
  });

  it("rejects a stream the connection drops after text as a network failure", async () => {
    const encoder = new TextEncoder();
    const dropped = () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  id: "1",
                  created: 0,
                  model: "m",
                  choices: [{ index: 0, delta: { content: "The program" } }],
                })}\n\n`
              )
            );
          },
          // Later, as a real drop: an error in `start` would drop the queue
          async pull(controller) {
            await new Promise((resolve) => setTimeout(resolve, 10));
            controller.error(new TypeError("network error"));
          },
        }),
        { headers: { "content-type": "text/event-stream" } }
      );
    const { fetch } = fakeFetch(dropped);
    const text: string[] = [];

    const failure = await runTurn({
      model: openAi(fetch),
      messages: USER,
      onText: (delta) => text.push(delta),
    }).catch((e: unknown) => e);

    expect(text.join("")).toBe("The program");
    expect(failure).toBeInstanceOf(AiTurnError);
    expect((failure as AiTurnError).kind).toBe("network");
  });

  it("keeps a programming TypeError a provider failure", async () => {
    const { fetch } = fakeFetch(() => {
      throw new TypeError("x.fetch is not a function");
    });

    const failure = await runTurn({
      model: openAi(fetch),
      messages: USER,
    }).catch((e: unknown) => e);

    expect((failure as AiTurnError).kind).toBe("provider");
  });

  it("rejects a refusal with its category", async () => {
    const { fetch } = fakeFetch(
      anthropicText("", "refusal", { type: "refusal", category: "cyber" })
    );

    const turn = runTurn({ model: anthropic(fetch), messages: USER });

    await expect(turn).rejects.toThrow(AiTurnError);
    await expect(turn).rejects.toThrow(/cyber/);
    await expect(turn).rejects.toMatchObject({ kind: "refusal" });
  });
});
