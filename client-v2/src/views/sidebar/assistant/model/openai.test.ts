import { createOpenAiProvider } from "./openai";
import { PgAssistant, type ChatItem } from "../store";

vi.mock("./prompt", () => ({
  systemPrompt: () => "system",
  describeProject: () => "project",
}));

vi.mock("./tools", () => ({
  createTools: () => [
    {
      name: "write_file",
      description: "",
      schema: { type: "object", properties: {}, additionalProperties: false },
      run: () => "Wrote src/lib.rs.",
    },
  ],
}));

/** A response body that yields `events` as one SSE chunk each */
const body = (events: string[]) => {
  let i = 0;
  return {
    getReader: () => ({
      read: async () =>
        i < events.length
          ? { done: false, value: Buffer.from(events[i++]) }
          : { done: true, value: undefined },
      releaseLock: () => {},
    }),
  };
};

/** Queue one response body per round trip the loop is expected to make */
const respondWith = (...rounds: string[][]) => {
  const queue = [...rounds];
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    body: body(queue.shift() ?? []),
  })) as unknown as typeof fetch;
};

const data = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;

const text = (content: string) => data({ choices: [{ delta: { content } }] });

const toolCall = (name: string) =>
  data({
    choices: [
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: "call_1",
              function: { name, arguments: "{}" },
            },
          ],
        },
      },
    ],
  });

const provider = () =>
  createOpenAiProvider({
    id: "default",
    url: "/api/agent",
    baseUrl: "",
    model: "",
    apiKey: "",
    label: "default backend",
  });

const errors = () =>
  PgAssistant.items
    .filter(
      (item): item is Extract<ChatItem, { kind: "error" }> =>
        item.kind === "error"
    )
    .map((item) => item.text);

beforeEach(() => PgAssistant.clear());

describe("the OpenAI-compatible turn loop", () => {
  it("reports an empty response when the turn did nothing at all", async () => {
    respondWith([data({ choices: [{ delta: {} }] }), "data: [DONE]\n\n"]);

    await provider().send("hi");

    expect(errors()).toEqual([
      "default backend returned an empty response. Try again, or pick another model.",
    ]);
  });

  it("stays quiet when a turn that did work has nothing left to say", async () => {
    respondWith(
      [toolCall("write_file"), "data: [DONE]\n\n"],
      [data({ choices: [{ delta: {} }] }), "data: [DONE]\n\n"]
    );

    await provider().send("make the change");

    expect(errors()).toEqual([]);
  });

  it("still reports text-only turns normally", async () => {
    respondWith([text("Done."), "data: [DONE]\n\n"]);

    await provider().send("hi");

    expect(errors()).toEqual([]);
  });

  it("surfaces an error the upstream sends mid-stream", async () => {
    respondWith([data({ error: { message: "upstream exploded" } })]);

    await expect(provider().send("hi")).rejects.toThrow("upstream exploded");
  });
});

describe("an error from the endpoint", () => {
  const KEY = "sk-redact-0123456789abcdef";

  it("leaves no part of the key in the message, wherever the body cuts", async () => {
    // Past the 300 characters the message keeps, so a cut before redacting
    // would leave the key's head behind
    const echoed = `${"x".repeat(290)}${KEY} is not a valid key.`;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(echoed, { status: 401, statusText: "Unauthorized" })
    );
    const keyed = createOpenAiProvider({
      id: "openai",
      baseUrl: "https://api.example.test/v1",
      model: "gpt-x",
      apiKey: KEY,
    });

    const failure = await keyed.send("hi").catch((e: Error) => e.message);

    expect(failure).toContain("401");
    for (let i = 0; i + 8 <= KEY.length; i++) {
      expect(failure).not.toContain(KEY.slice(i, i + 8));
    }
  });
});
