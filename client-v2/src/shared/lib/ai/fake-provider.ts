// Test-only fakes of the provider wire formats; nothing outside `*.test.ts` imports this

/** One request a fake `fetch` received */
export interface SentRequest {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

type Answer =
  | Response
  | ((request: SentRequest) => Response | Promise<Response>);

/**
 * A `fetch` that answers from a queue and records every request.
 * A request past the end of the queue fails the test.
 */
export const fakeFetch = (...answers: Answer[]) => {
  const sent: SentRequest[] = [];
  const queue = Array.from(answers);
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const request: SentRequest = {
      url: String(input),
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : {},
    };
    sent.push(request);
    const answer = queue.shift();
    if (!answer) throw new Error(`Unexpected request ${sent.length}`);
    return typeof answer === "function" ? answer(request) : answer;
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, sent };
};

/** An event-stream response whose body arrives in exactly these pieces */
export const sse = (pieces: string[]) => {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
  return new Response(body, {
    headers: { "content-type": "text/event-stream" },
  });
};

const frame = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;

const chunk = (delta: Record<string, unknown>, finishReason?: string) => ({
  id: "chatcmpl-1",
  object: "chat.completion.chunk",
  created: 0,
  model: "test",
  choices: [{ index: 0, delta, finish_reason: finishReason ?? null }],
});

/** A chat-completions stream answering with text */
export const openAiText = (text: string) =>
  sse([
    frame(chunk({ role: "assistant", content: text })),
    frame(chunk({}, "stop")),
    "data: [DONE]\n\n",
  ]);

/** A chat-completions stream answering with one tool call */
export const openAiToolCall = (id: string, name: string, args: unknown) =>
  sse([
    frame(
      chunk({
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id,
            type: "function",
            function: { name, arguments: JSON.stringify(args) },
          },
        ],
      })
    ),
    frame(chunk({}, "tool_calls")),
    "data: [DONE]\n\n",
  ]);

/** A chat-completions error answer with this status */
export const openAiError = (status: number, message: string) =>
  new Response(JSON.stringify({ error: { message, type: "error" } }), {
    status,
    headers: { "content-type": "application/json" },
  });

/** An Anthropic Messages stream answering with text, ending as given */
export const anthropicText = (
  text: string,
  stopReason: string,
  stopDetails?: Record<string, unknown>
) =>
  sse(
    [
      {
        type: "message_start",
        message: {
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "test",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text },
      },
      { type: "content_block_stop", index: 0 },
      {
        type: "message_delta",
        delta: {
          stop_reason: stopReason,
          stop_sequence: null,
          stop_details: stopDetails ?? null,
        },
        usage: { output_tokens: 1 },
      },
      { type: "message_stop" },
    ].map((event) => `event: ${event.type}\n${frame(event)}`)
  );
