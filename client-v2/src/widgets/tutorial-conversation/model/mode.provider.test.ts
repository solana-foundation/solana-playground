/* eslint-disable unicorn/no-null -- tutorial flow v2 predates this rule; cleanup tracked from SF#94 */
import type { ActBeat, TutorialDefinition } from "@/entities/tutorial";
import type {
  ConversationProgress,
  Turn,
} from "@/features/tutorial-conversation";
import {
  fakeFetch,
  openAiText,
  openAiToolCall,
} from "@/shared/lib/ai/__fixtures__/fake-provider";
import { createProvider } from "@/views/sidebar/assistant/model/provider";
import { PgAssistant } from "@/views/sidebar/assistant/store";

import hello from "../../../tutorials/hello-anchor/tutorial.json";
import { nextStepLabel } from "./card-labels";
import { BEGIN_INVITATION } from "./context";
import { tutorialMode } from "./mode";

// The lesson as a test sets it: its save and the card that acts
const lesson = vi.hoisted(() => ({
  state: {
    context: null as { definition: unknown } | null,
    engine: { progress: null as unknown },
  },
  live: null as unknown,
}));
vi.mock("@/features/tutorial-conversation", () => ({
  PgConversation: {
    state: lesson.state,
    view: vi.fn(() => ({ live: lesson.live })),
  },
}));
vi.mock("@/utils/explorer", () => ({
  PgExplorer: {
    tabs: [],
    currentFilePath: null,
    getRelativePath: (path: string) => path,
  },
}));
// The mode's own tools only: the general ones need a workspace
vi.mock("@/views/sidebar/assistant/model/tools", async () => {
  const { PgAssistant: assistant } = await import(
    "@/views/sidebar/assistant/store"
  );
  return { createTools: () => assistant.mode?.tools ?? [] };
});
vi.mock("@/views/sidebar/assistant/model/prompt", () => ({
  systemPrompt: () => "system",
  describeProject: () => "project",
}));

const definition = hello as unknown as TutorialDefinition;
const [first, second] = definition.steps;

const progressAt = (
  cursor: ConversationProgress["cursor"]
): ConversationProgress => ({
  version: 1,
  passed: [],
  finishedAt: null,
  startedAt: cursor.kind === "intro" ? null : 1000,
  restartedAt: null,
  cursor,
  beats: {},
  runs: {},
  times: {},
  said: [],
  proposals: [],
  accounts: {},
});

const inStep = progressAt({
  kind: "step",
  stepId: first.id,
  beat: 0,
  fail: false,
});

const build = first.beats.find((b): b is ActBeat => b.kind === "act");
const ask = first.beats.find((b) => b.kind === "ask");
if (!build || !ask || ask.kind !== "ask") {
  throw new Error("Hello Anchor's first step has no question or act");
}

/** The lesson at this save, with this card acting */
const at = (progress: ConversationProgress, live: unknown) => {
  lesson.state.context = { definition };
  lesson.state.engine.progress = progress;
  lesson.live = live as Turn;
};

type Sent = Array<{ role: string; content: unknown }>;
const messagesOf = (body: Record<string, unknown>) => body.messages as Sent;
/** A message's words: its text, or its parts' texts on separate lines */
const textOf = ({ content }: Sent[number]): string => {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return JSON.stringify(content);
  return content
    .map((part: { text?: unknown }) =>
      typeof part.text === "string" ? part.text : JSON.stringify(part)
    )
    .join("\n");
};

afterEach(() => {
  vi.restoreAllMocks();
  PgAssistant.clear();
});

describe("the tutorial assistant asked again at a later card (HOO-2823)", () => {
  it("sends the tutorial as it is now after the history, and no menu result that says they have not started", async () => {
    const { fetch, sent } = fakeFetch(
      openAiToolCall("call-1", "open_menu", {}),
      openAiText(`Here are the steps. ${BEGIN_INVITATION}`),
      openAiText("Answer the question card."),
      openAiText("Press Build on the card."),
      openAiText("Press Next.")
    );
    vi.spyOn(globalThis, "fetch").mockImplementation(fetch);
    const mode = PgAssistant.setMode(tutorialMode({ openMenu: vi.fn() }));
    const provider = createProvider({ id: "default", apiKey: "" });

    try {
      // Before Start, the learner asks for the menu
      at(progressAt({ kind: "intro" }), { kind: "intro", id: "intro" });
      await provider.send("show me the steps");
      const before = messagesOf(sent[0].body);
      expect(textOf(before[before.length - 1])).toContain(
        `The tutorial now: they have not pressed Start yet: end your reply with "${BEGIN_INVITATION}"`
      );

      const cases: Array<{ live: unknown; now: string }> = [
        {
          live: { kind: "ask", open: true, beatId: ask.id, ask, hinted: false },
          now: "It waits on the open question",
        },
        {
          live: { kind: "act", beatId: build.id, act: build, state: "live" },
          now: `It waits for the "${build.button}" button on the "${build.title}" card.`,
        },
        {
          live: { kind: "win", stepId: first.id, last: false },
          now: `"${nextStepLabel(second.title)}" button`,
        },
      ];
      for (const { live, now } of cases) {
        at(inStep, live);
        await provider.send("what do I do now?");
        const messages = messagesOf(sent[sent.length - 1].body);
        const newest = messages[messages.length - 1];

        expect(newest.role).toBe("user");
        expect(textOf(newest)).toContain("what do I do now?");
        expect(textOf(newest)).toContain(
          `The tutorial now: step 1 of ${definition.steps.length}, ${first.title}.`
        );
        expect(textOf(newest)).toContain(now);
        expect(textOf(newest)).toContain(
          "Earlier turns describe the tutorial as it was then"
        );
        // Neither a stale tool result nor an earlier turn's note stays in the history
        for (const message of messages.slice(0, -1)) {
          expect(textOf(message)).not.toContain("They have not started");
          expect(textOf(message)).not.toContain("The tutorial now");
        }
      }
      // The menu ran once, before Start, and its result went back as it was
      const menuResult = messagesOf(sent[1].body).find(
        (m) => m.role === "tool"
      );
      expect(menuResult?.content).toBe("The menu is open.");
    } finally {
      mode.dispose();
    }
  });
});
