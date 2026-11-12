import type { Page, Request, Route } from "@playwright/test";

import {
  expect,
  LONG,
  startProject,
  stubAiStatus,
  stubSignedIn,
  test,
} from "./fixtures";

/**
 * Switching backend mid-thread keeps the conversation for the next turn, tool
 * calls included (HOO-1752). The thread is the one transcript: `connect` keeps
 * it, and `useTurn` seeds the next backend's provider from it. So what each
 * test reads is the request the next backend receives, not the panel, which
 * would look the same if the model had been told nothing.
 */

const DEFAULT_MODEL = "z-ai/glm-5.3-flash:US";
const KEY = "sk-e2e-own-key-0123456789";
const OWN = {
  id: "openai",
  apiKey: KEY,
  endpoint: { baseUrl: "https://api.example.test/v1", model: "gpt-x" },
};
const HOSTED = { id: "default", apiKey: "" };
const OWN_URL = `${OWN.endpoint.baseUrl}/chat/completions`;
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

/** Asking for this makes a stubbed model read the program before it answers */
const READS = /read the program/i;
/** The stubbed model's text for a prompt: the thread shows it once the turn is done */
const replyTo = (prompt: string) => `reply to: ${prompt}`;

interface WireCall {
  id: string;
  function: { name: string; arguments: string };
}

/** A message of the OpenAI-shaped body the hosted backend and an own endpoint receive */
interface WireMessage {
  role: string;
  content?: string | { type: string; text?: string }[];
  tool_calls?: WireCall[];
  tool_call_id?: string;
}

const textOf = ({ content }: WireMessage) =>
  typeof content === "string"
    ? content
    : (content ?? []).map((part) => part.text ?? "").join("");

/** The conversation a request carries, without the system prompt, which holds the project */
const conversationIn = (body: string) =>
  (JSON.parse(body) as { messages: WireMessage[] }).messages.filter(
    ({ role }) => role !== "system"
  );

const sseOf = (...chunks: unknown[]) =>
  `${chunks
    .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
    .join("")}data: [DONE]\n\n`;

/**
 * Answers a turn as a chat-completions model: a prompt matching `READS` first
 * gets a `read_file` call, and everything else the text for the last prompt
 */
const answerTurn = (route: Route) => {
  const messages = conversationIn(route.request().postData() ?? "{}");
  const last = messages[messages.length - 1];
  const prompt = textOf(
    messages.filter(({ role }) => role === "user").slice(-1)[0]
  );
  const body =
    last.role === "user" && READS.test(prompt)
      ? sseOf(
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: `live_${messages.length}`,
                      function: {
                        name: "read_file",
                        arguments: JSON.stringify({ path: "src/lib.rs" }),
                      },
                    },
                  ],
                },
              },
            ],
          },
          { choices: [{ delta: {}, finish_reason: "tool_calls" }] }
        )
      : sseOf({
          choices: [
            { delta: { content: replyTo(prompt) }, finish_reason: "stop" },
          ],
        });
  return route.fulfill({
    status: 200,
    contentType: "text/event-stream",
    body,
  });
};

/** A deployment that serves the hosted backend to a signed-in user; returns the requests it gets */
const stubHosted = async (page: Page) => {
  const requests: Request[] = [];
  await stubSignedIn(page.context());
  await stubAiStatus(page, DEFAULT_MODEL);
  await page.route("**/api/agent", (route) => {
    requests.push(route.request());
    return answerTurn(route);
  });
  return requests;
};

const connect = (page: Page, connection: unknown) =>
  page.evaluate((c) => {
    const assistant = (
      window as Window & { __pgAssistant?: { connect: (c: unknown) => void } }
    ).__pgAssistant;
    if (!assistant) {
      throw new Error("Expected the assistant's test handle on window");
    }
    assistant.connect(c);
  }, connection);

const openProject = async (page: Page, name: string) => {
  await page.goto("/");
  await startProject(page, name, LONG);
  await expect(composer(page)).toBeVisible(LONG);
};

const composer = (page: Page) =>
  page.getByRole("textbox", { name: "Message the assistant" });

/** Sends `prompt` and waits for the turn to end in the stubbed model's text */
const say = async (page: Page, prompt: string) => {
  await composer(page).fill(prompt);
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page
      .getByRole("log", { name: "Conversation" })
      .getByText(replyTo(prompt), { exact: true })
  ).toBeVisible(LONG);
  // Send is Stop until the turn has unwound, and a switch before then cuts it
  await expect(
    page.getByRole("button", { name: "Send", exact: true })
  ).toBeVisible(LONG);
};

/** The request that opened the turn for `prompt`: the one that ends in that prompt */
const turnFor = (prompt: string) => (requests: Request[]) => {
  const request = requests.find((candidate) => {
    const messages = conversationIn(candidate.postData() ?? "{}");
    const last = messages[messages.length - 1];
    return last.role === "user" && textOf(last) === prompt;
  });
  if (!request) throw new Error(`Expected a request for "${prompt}"`);
  return request;
};

/** A conversation as lines, so a failure shows what the model was told, in order */
const linesOf = (messages: WireMessage[]) =>
  messages.map((message) => {
    const [call] = message.tool_calls ?? [];
    if (call) return `call ${call.function.name}`;
    if (message.role === "tool") return "result";
    return `${message.role}: ${textOf(message)}`;
  });

/**
 * Every result answers the call just before it, under the id replay gave the
 * pair (`toReplayMessagesWith`), not the one the backend that made the call
 * chose, and carries the template's `src/lib.rs`: a model shown a call with no
 * result will often run it again
 */
const expectCallsAnswered = (messages: WireMessage[]) => {
  const results = messages.flatMap((message, i) =>
    message.role === "tool" ? [{ message, i }] : []
  );
  expect(results.length).toBeGreaterThan(0);
  for (const { message, i } of results) {
    expect(message.tool_call_id).toMatch(/^call_\d+$/);
    expect(message.tool_call_id).toBe(messages[i - 1].tool_calls?.[0].id);
    expect(JSON.stringify(message.content)).toContain("anchor_lang");
  }
};

test.describe("switching backend mid-thread", () => {
  test.setTimeout(240_000);

  test("gives the next backend the conversation, tool calls included", async ({
    page,
  }) => {
    const hosted = await stubHosted(page);
    const own: Request[] = [];
    await page.route(OWN_URL, (route) => {
      own.push(route.request());
      return answerTurn(route);
    });
    await openProject(page, "backend-switch");

    const first = "Read the program on the hosted model";
    await say(page, first);

    await connect(page, OWN);
    const second = "Read the program on my key";
    await say(page, second);

    const onOwn = conversationIn(turnFor(second)(own).postData() ?? "{}");
    expect(linesOf(onOwn)).toEqual([
      `user: ${first}`,
      "call read_file",
      "result",
      `assistant: ${replyTo(first)}`,
      `user: ${second}`,
    ]);
    expectCallsAnswered(onOwn);

    await connect(page, HOSTED);
    const third = "And back on the hosted model";
    await say(page, third);

    const backOnHostedRequest = turnFor(third)(hosted);
    const backOnHosted = conversationIn(backOnHostedRequest.postData() ?? "{}");
    expect(linesOf(backOnHosted)).toEqual([
      `user: ${first}`,
      "call read_file",
      "result",
      `assistant: ${replyTo(first)}`,
      `user: ${second}`,
      "call read_file",
      "result",
      `assistant: ${replyTo(second)}`,
      `user: ${third}`,
    ]);
    expectCallsAnswered(backOnHosted);
    // The own key's turns are in the hosted request; the key itself is not
    expect(backOnHostedRequest.postData()).not.toContain(KEY);
    expect(JSON.stringify(backOnHostedRequest.headers())).not.toContain(KEY);
  });

  test("gives a provider with its own format the same conversation", async ({
    page,
  }) => {
    await stubHosted(page);
    const anthropic: string[] = [];
    const text = "Now on Anthropic";
    await page.route(ANTHROPIC_URL, (route) => {
      anthropic.push(route.request().postData() ?? "");
      const events = [
        {
          type: "message_start",
          message: {
            id: "msg_1",
            type: "message",
            role: "assistant",
            content: [],
            model: "claude",
            usage: { input_tokens: 1, output_tokens: 1 },
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
          delta: { type: "text_delta", text: replyTo(text) },
        },
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 1 },
        },
        { type: "message_stop" },
      ];
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: events
          .map(
            (event) =>
              `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
          )
          .join(""),
      });
    });
    await openProject(page, "backend-switch-format");

    const first = "Read the program on the hosted model";
    await say(page, first);

    await connect(page, { id: "anthropic", apiKey: KEY });
    await say(page, text);

    const { messages } = JSON.parse(anthropic[0]) as {
      messages: {
        role: string;
        content: {
          type: string;
          text?: string;
          id?: string;
          name?: string;
          tool_use_id?: string;
          content?: unknown;
        }[];
      }[];
    };
    const blocks = messages.flatMap(({ role, content }) =>
      content.map((block) => ({ role, block }))
    );
    expect(
      blocks.map(({ role, block }) =>
        block.type === "text"
          ? `${role}: ${block.text}`
          : `${role} ${block.type}`
      )
    ).toEqual([
      `user: ${first}`,
      "assistant tool_use",
      "user tool_result",
      `assistant: ${replyTo(first)}`,
      `user: ${text}`,
    ]);
    const use = blocks[1].block;
    const result = blocks[2].block;
    expect(use.name).toBe("read_file");
    // An id from the hosted backend would not be valid here, so replay
    // renumbers the pair, and the two must still agree
    expect(use.id).toMatch(/^call_\d+$/);
    expect(result.tool_use_id).toBe(use.id);
    expect(JSON.stringify(result.content)).toContain("anchor_lang");
  });
});
