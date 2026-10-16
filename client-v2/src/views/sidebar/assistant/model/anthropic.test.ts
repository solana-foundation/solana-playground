import { createAnthropicProvider } from "./anthropic";
import { PgAssistant, type ChatItem } from "../store";

vi.mock("./prompt", () => ({
  systemPrompt: () => "system",
  describeProject: () => "project",
}));

vi.mock("./tools", () => ({ createTools: () => [] }));

/** One round trip: its stream events and the message it finishes with */
interface Round {
  events: unknown[];
  stopReason: string;
  category?: string;
}

const sdk = vi.hoisted(() => ({
  params: undefined as Record<string, unknown> | undefined,
  rounds: [] as Round[],
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    beta = {
      messages: {
        toolRunner: (params: Record<string, unknown>) => {
          sdk.params = params;
          const rounds = sdk.rounds;
          return {
            params,
            pushMessages: () => {},
            async *[Symbol.asyncIterator]() {
              for (const round of rounds) {
                yield {
                  async *[Symbol.asyncIterator]() {
                    yield* round.events;
                  },
                  finalMessage: async () => ({
                    content: [],
                    stop_reason: round.stopReason,
                    stop_details: round.category
                      ? { type: "refusal", category: round.category }
                      : null,
                  }),
                };
              }
            },
          };
        },
      },
    };
  },
}));

const blockStart = (type: string) => ({
  type: "content_block_start",
  content_block: { type },
});

const delta = (type: "text_delta" | "thinking_delta", value: string) => ({
  type: "content_block_delta",
  delta:
    type === "text_delta" ? { type, text: value } : { type, thinking: value },
});

const replies = () =>
  PgAssistant.items
    .filter(
      (item): item is Extract<ChatItem, { kind: "assistant" }> =>
        item.kind === "assistant"
    )
    .map((item) => item.text);

beforeEach(() => {
  PgAssistant.clear();
  sdk.params = undefined;
  sdk.rounds = [];
});

describe("the Anthropic provider", () => {
  it("asks for dropped, not rejected, stale thinking blocks and a refusal fallback", async () => {
    sdk.rounds = [{ events: [], stopReason: "end_turn" }];

    await createAnthropicProvider("sk-test").send("hi");

    expect(sdk.params).toMatchObject({
      model: "claude-opus-5-5",
      output_config: { effort: "medium" },
      thinking: {
        type: "adaptive",
        display: "updates",
        block_binding: { prefix_mismatch_behavior: "drop_block" },
      },
      fallbacks: "default",
    });
    expect(sdk.params?.betas).toEqual(
      expect.arrayContaining([
        "thinking-binding-controls-2026-08-01",
        "thinking-display-updates-2026-08-18",
        "server-side-fallback-2026-07-01",
      ])
    );
  });

  it("shows progress notes from thinking blocks as their own paragraph", async () => {
    sdk.rounds = [
      {
        events: [
          blockStart("thinking"),
          delta("thinking_delta", "Reading lib.rs."),
          blockStart("text"),
          delta("text_delta", "The account is missing."),
        ],
        stopReason: "end_turn",
      },
    ];

    await createAnthropicProvider("sk-test").send("why does it fail?");

    expect(replies()).toEqual(["Reading lib.rs.\n\nThe account is missing."]);
  });

  it("reports a refusal with its category instead of an empty reply", async () => {
    sdk.rounds = [{ events: [], stopReason: "refusal", category: "cyber" }];

    await expect(createAnthropicProvider("sk-test").send("hi")).rejects.toThrow(
      "The model declined this request (cyber)."
    );
  });
});
