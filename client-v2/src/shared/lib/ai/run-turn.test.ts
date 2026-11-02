import {
  anthropicText,
  fakeFetch,
  openAiError,
  openAiText,
  openAiToolCall,
  sse,
} from "./__fixtures__/fake-provider";
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
    const failOn = async (response: Response) => {
      const { fetch } = fakeFetch(response);
      return (await runTurn({
        model: openAi(fetch),
        messages: USER,
        apiKey: "test-key-123",
      }).catch((e: unknown) => e)) as AiTurnError;
    };

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

    it("a refused key says so, with no 401 in sight", async () => {
      const failure = await failOn(
        openAiError(401, "Incorrect API key provided: test-key-123")
      );

      expect(failure.kind).toBe("key-refused");
      expect(failure.message).toBe(
        "The model's provider did not accept this key. Check it in Settings, or use the hosted model."
      );
      expect(failure.detail).toContain(
        "Incorrect API key provided: [your key]"
      );
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
