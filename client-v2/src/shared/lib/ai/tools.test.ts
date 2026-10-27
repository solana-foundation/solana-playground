import { z } from "zod";
import type { ModelMessage } from "ai";

import {
  fakeFetch,
  openAiText,
  openAiToolCall,
} from "./__fixtures__/fake-provider";
import { createModel } from "./models";
import { runTurn } from "./run-turn";
import { toSdkTools } from "./tools";
import type { ToolDefinition } from "./types";

const USER: ModelMessage[] = [{ role: "user", content: "hello" }];

const openAi = (fetch: typeof globalThis.fetch) =>
  createModel({
    provider: "openai",
    baseUrl: "https://llm.test/v1",
    model: "m",
    fetch,
  });

describe("toSdkTools", () => {
  it("sends the next request only after a tool awaiting approval resolves", async () => {
    const { fetch, sent } = fakeFetch(
      openAiToolCall("c1", "write", {}),
      openAiText("done")
    );
    let approve!: (result: string) => void;
    const approval = new Promise<string>((resolve) => (approve = resolve));
    const run = vi.fn(() => approval);

    const turn = runTurn({
      model: openAi(fetch),
      messages: USER,
      tools: toSdkTools([
        {
          name: "write",
          description: "Write",
          schema: {
            type: "object",
            properties: {},
            additionalProperties: false,
          },
          run,
        },
      ]),
    });
    await vi.waitFor(() => expect(run).toHaveBeenCalled());

    expect(sent).toHaveLength(1);
    approve("approved");
    await turn;
    expect(sent).toHaveLength(2);
    expect(JSON.stringify(sent[1].body.messages)).toContain("approved");
  });

  it("passes the SDK's abort signal to run", async () => {
    const run = vi.fn(() => "ok");
    const { stop } = toSdkTools([
      {
        name: "stop",
        description: "Stop",
        schema: { type: "object", properties: {}, additionalProperties: false },
        run,
      },
    ]);
    const controller = new AbortController();

    await stop.execute?.(
      {},
      {
        toolCallId: "c1",
        messages: [],
        abortSignal: controller.signal,
        context: undefined,
      }
    );

    expect(run).toHaveBeenCalledWith({}, { signal: controller.signal });
  });

  it("throws on two tools with one name", () => {
    const named = (description: string): ToolDefinition => ({
      name: "explorer__search",
      description,
      schema: { type: "object", properties: {}, additionalProperties: false },
      run: () => description,
    });

    expect(() => toSdkTools([named("gateway"), named("local")])).toThrow(
      'Two tools are named "explorer__search"'
    );
  });

  it("sends a zod schema as JSON Schema", async () => {
    const { fetch, sent } = fakeFetch(openAiText("ok"));
    const read: ToolDefinition<z.ZodObject<{ path: z.ZodString }>> = {
      name: "read",
      description: "Read",
      schema: z.object({ path: z.string() }),
      run: ({ path }) => path,
    };

    await runTurn({
      model: openAi(fetch),
      messages: USER,
      tools: toSdkTools([read]),
    });

    const [declared] = sent[0].body.tools as Array<{
      function: { parameters: Record<string, unknown> };
    }>;
    expect(declared.function.parameters).toMatchObject({
      type: "object",
      required: ["path"],
      properties: { path: { type: "string" } },
    });
  });
});
