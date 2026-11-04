import type { ModelMessage } from "ai";

import type { ChatItem } from "../../../views/sidebar/assistant/store";
import { isToolCallRecord, type ToolCallRecord } from "./tool-call";

/**
 * Characters of stored calls one replay sends, newest first, counted as JSON
 * writes them. The default backend refuses a body over 512 KB
 * (`PG_AI_MAX_BODY_BYTES`), which also carries the prompt, the project and the
 * conversation's text, and a character can take three bytes; a thread keeps
 * up to 200 items, so its records alone could pass 1 MB at their caps. Older
 * calls past the budget are left out, as all were before HOO-2425: the
 * conversation's text still says what they did.
 */
const REPLAY_CALL_BUDGET = 64_000;

const sizeOf = (call: ToolCallRecord) =>
  call.name.length +
  JSON.stringify(call.input).length +
  JSON.stringify(call.output).length;

/**
 * The records a replay sends, by item id: the newest that fit the budget,
 * measured as they are sent
 */
const recordsInBudget = (
  records: readonly { id: string; call: ToolCallRecord }[]
) => {
  const kept = new Map<string, ToolCallRecord>();
  let left = REPLAY_CALL_BUDGET;
  for (let i = records.length - 1; i >= 0; i--) {
    const { id, call } = records[i];
    left -= sizeOf(call);
    if (left < 0) break;
    kept.set(id, call);
  }
  return kept;
};

/** Whether a path a stored call names is in the assistant's context now */
type IsInContext = (path: string) => boolean;

/** Said in place of a file's content the user has since kept from the model */
const outOfContext = (path: string) =>
  `[${path} was taken out of the context; its content is not sent again]`;

/**
 * A stored call as a replay sends it: for a file that is no longer in the
 * context, the content a `read_file` returned and a `write_file` wrote is
 * replaced by a note saying so. The call and its result stay, so every
 * provider still gets a result for each call.
 */
const shownWith =
  (isInContext: IsInContext) =>
  (call: ToolCallRecord): ToolCallRecord => {
    const { path } = call.input;
    if (typeof path !== "string" || isInContext(path)) return call;
    if (call.name === "read_file" && !call.failed) {
      return {
        name: call.name,
        input: call.input,
        output: outOfContext(path),
      };
    }
    if (call.name === "write_file" && "content" in call.input) {
      return {
        name: call.name,
        input: { path, content: outOfContext(path) },
        output: call.output,
      };
    }
    return call;
  };

/**
 * Rebuild the model's history from a stored thread: what was said, and the
 * tool calls that finished with what they returned (HOO-2425), each in its
 * place, the newest within `REPLAY_CALL_BUDGET`.
 *
 * A call is replayed from its stored record (`ToolCallRecord`), never from
 * the marker a tool draws, and only with its result: a model shown a call
 * with no result will often repeat it. Each pair gets a fresh id, `call_<n>`,
 * because the SDK's ids from one backend are not valid on another, and a
 * thread is replayed to whichever backend is connected now. Approvals, errors
 * and notices stay out: the result of the tool behind an approval card is in
 * its record.
 *
 * A file the user took out of the context since is kept from the model here
 * too: its stored content is replaced at replay (`shownWith`), and the
 * thread's own record stays whole, so adding the file back sends it again.
 *
 * Provider-only parts (reasoning signatures, Gemini's thought signatures)
 * were never stored, so a restored thread is honest history rather than a
 * resumed session. Results are cut when stored (`toToolCallRecordWith`); the live
 * project goes with every turn anyway (`describeProject`), so a file the model
 * read is in front of it again.
 *
 * @param isInContext whether a path the model asked for is in the context now
 */
export const toReplayMessagesWith =
  (isInContext: IsInContext) =>
  (items: readonly ChatItem[]): ModelMessage[] => {
    const shown = shownWith(isInContext);
    const records = items.flatMap((item) =>
      isToolCallRecord(item) ? [{ id: item.id, call: shown(item.call) }] : []
    );
    const replayed = recordsInBudget(records);
    let count = 0;
    const messages = items.flatMap((item): ModelMessage[] => {
      if (isToolCallRecord(item)) {
        const call = replayed.get(item.id);
        if (!call) return [];
        const toolCallId = `call_${++count}`;
        const { name: toolName, input, output, failed } = call;
        return [
          {
            role: "assistant",
            content: [{ type: "tool-call", toolCallId, toolName, input }],
          },
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId,
                toolName,
                output: failed
                  ? { type: "error-text", value: output }
                  : { type: "text", value: output },
              },
            ],
          },
        ];
      }
      if (
        (item.kind === "user" || item.kind === "assistant") &&
        item.text.trim()
      ) {
        return [{ role: item.kind, content: item.text }];
      }
      return [];
    });
    // A thread cut to its newest items (`capThread`) can open on a reply or a
    // call; Anthropic refuses a conversation that does not open with the user
    const first = messages.findIndex((message) => message.role === "user");
    return first === -1 ? [] : messages.slice(first);
  };

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("features/persistence/model/replay", () => {
    const base = { id: "a", createdAt: "2026-01-01T00:00:00.000Z" };

    describe("toReplayMessagesWith", () => {
      const toReplayMessages = toReplayMessagesWith(() => true);

      it("keeps user and assistant text in order", () => {
        const items: ChatItem[] = [
          { ...base, kind: "user", text: "hi" },
          { ...base, kind: "assistant", text: "hello" },
        ];

        expect(toReplayMessages(items)).toEqual([
          { role: "user", content: "hi" },
          { role: "assistant", content: "hello" },
        ]);
      });

      it("drops tool, approval, error and notice items", () => {
        const items: ChatItem[] = [
          { ...base, kind: "tool", label: "read src/lib.rs" },
          {
            ...base,
            kind: "approval",
            status: "allowed",
            request: { type: "command", name: "build", effect: "x" },
          },
          { ...base, kind: "error", text: "boom" },
          { ...base, kind: "notice", text: "stopped" },
        ];

        expect(toReplayMessages(items)).toEqual([]);
      });

      it("drops empty text, which a stopped turn leaves behind", () => {
        const items: ChatItem[] = [
          { ...base, kind: "assistant", text: "  " },
          { ...base, kind: "user", text: "" },
        ];

        expect(toReplayMessages(items)).toEqual([]);
      });

      it("keeps the conversation readable around dropped items", () => {
        const items: ChatItem[] = [
          { ...base, kind: "user", text: "add a log" },
          { ...base, kind: "tool", label: "write src/lib.rs" },
          {
            ...base,
            kind: "approval",
            status: "allowed",
            request: {
              type: "patch",
              path: "src/lib.rs",
              before: "a",
              after: "b",
            },
          },
          { ...base, kind: "assistant", text: "Added it." },
        ];

        expect(toReplayMessages(items)).toEqual([
          { role: "user", content: "add a log" },
          { role: "assistant", content: "Added it." },
        ]);
      });

      const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;
      const said = (item: {
        n: number;
        kind: "user" | "assistant";
        text: string;
      }): ChatItem => ({
        id: id(item.n),
        createdAt: base.createdAt,
        kind: item.kind,
        text: item.text,
      });
      const record = (call: {
        n: number;
        name: string;
        output: string;
        failed?: true;
      }): ChatItem => {
        const { n, name, output, failed } = call;
        return {
          id: id(n),
          createdAt: base.createdAt,
          kind: "tool",
          label: name,
          call: failed
            ? { name, input: { path: "src/lib.rs" }, output, failed }
            : { name, input: { path: "src/lib.rs" }, output },
        };
      };

      it("replays a stored call as a tool call and its result, in place", () => {
        const items: ChatItem[] = [
          said({ n: 1, kind: "user", text: "read lib.rs" }),
          {
            id: id(2),
            createdAt: base.createdAt,
            kind: "tool",
            label: "read src/lib.rs",
          },
          record({ n: 3, name: "read_file", output: "fn main() {}" }),
          said({ n: 4, kind: "assistant", text: "It has one function." }),
        ];

        expect(toReplayMessages(items)).toEqual([
          { role: "user", content: "read lib.rs" },
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "call_1",
                toolName: "read_file",
                input: { path: "src/lib.rs" },
              },
            ],
          },
          {
            role: "tool",
            content: [
              {
                type: "tool-result",
                toolCallId: "call_1",
                toolName: "read_file",
                output: { type: "text", value: "fn main() {}" },
              },
            ],
          },
          { role: "assistant", content: "It has one function." },
        ]);
      });

      it("replays a failed call as an error result", () => {
        const [, , result] = toReplayMessages([
          said({ n: 0, kind: "user", text: "read it" }),
          record({
            n: 1,
            name: "read_file",
            output: "Not found",
            failed: true,
          }),
        ]);

        expect(result).toEqual({
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: "call_1",
              toolName: "read_file",
              output: { type: "error-text", value: "Not found" },
            },
          ],
        });
      });

      it("numbers two calls in order, each result naming its own call", () => {
        const ids = toReplayMessages([
          said({ n: 0, kind: "user", text: "look around" }),
          record({ n: 1, name: "list_files", output: "a" }),
          record({ n: 2, name: "read_file", output: "b" }),
        ])
          .slice(1)
          .map(
            (message) =>
              (message.content as { toolCallId: string }[])[0].toolCallId
          );

        expect(ids).toEqual(["call_1", "call_1", "call_2", "call_2"]);
      });

      it("sends only the newest calls that fit its budget", () => {
        const items = [
          said({ n: 0, kind: "user", text: "read them all" }),
        ].concat(
          Array.from({ length: 30 }, (_, n) =>
            record({
              n: n + 1,
              name: "read_file",
              output: `${n + 1}`.padEnd(4_000, "x"),
            })
          )
        );

        const names = toReplayMessages(items).flatMap((message) =>
          message.role === "tool" ? [message] : []
        );

        // 64,000 characters hold 15 records of about 4,030 each
        expect(names).toHaveLength(15);
        const ids = names.map(
          (m) => (m.content as { toolCallId: string }[])[0].toolCallId
        );
        expect(ids[0]).toBe("call_1");
        expect(ids[14]).toBe("call_15");
        // The newest: records 16 to 30, in order
        const kept = names.map((m) =>
          parseInt(
            (m.content as { output: { value: string } }[])[0].output.value,
            10
          )
        );
        expect(kept).toEqual(Array.from({ length: 15 }, (_, n) => n + 16));
      });

      it("opens on the first user message, as Anthropic requires", () => {
        const messages = toReplayMessages([
          said({ n: 1, kind: "assistant", text: "the end of an older answer" }),
          record({ n: 2, name: "read_file", output: "fn main() {}" }),
          said({ n: 3, kind: "user", text: "and now?" }),
          said({ n: 4, kind: "assistant", text: "Now this." }),
        ]);

        expect(messages).toEqual([
          { role: "user", content: "and now?" },
          { role: "assistant", content: "Now this." },
        ]);
      });

      describe("a file taken out of the context", () => {
        const inContext = toReplayMessagesWith((path) => path !== "secret.rs");
        const call = (stored: {
          n: number;
          name: string;
          input: Record<string, unknown>;
          output: string;
        }): ChatItem => ({
          id: id(stored.n),
          createdAt: base.createdAt,
          kind: "tool",
          label: stored.name,
          call: {
            name: stored.name,
            input: stored.input,
            output: stored.output,
          },
        });
        const toolParts = (messages: ModelMessage[]) =>
          messages.flatMap((message): unknown[] =>
            Array.isArray(message.content) ? message.content : []
          );

        it("replays a read of it with a note in place of its content", () => {
          const messages = inContext([
            said({ n: 1, kind: "user", text: "read it" }),
            call({
              n: 2,
              name: "read_file",
              input: { path: "secret.rs" },
              output: "const KEY: u8 = 7;",
            }),
          ]);

          expect(toolParts(messages)).toEqual([
            {
              type: "tool-call",
              toolCallId: "call_1",
              toolName: "read_file",
              input: { path: "secret.rs" },
            },
            {
              type: "tool-result",
              toolCallId: "call_1",
              toolName: "read_file",
              output: {
                type: "text",
                value:
                  "[secret.rs was taken out of the context; its content is not sent again]",
              },
            },
          ]);
        });

        it("replays a write to it without the content written", () => {
          const messages = inContext([
            said({ n: 1, kind: "user", text: "fix it" }),
            call({
              n: 2,
              name: "write_file",
              input: { path: "secret.rs", content: "const KEY: u8 = 8;" },
              output: "Wrote secret.rs.",
            }),
          ]);

          expect(JSON.stringify(messages)).not.toContain("KEY");
          expect(toolParts(messages)[0]).toEqual({
            type: "tool-call",
            toolCallId: "call_1",
            toolName: "write_file",
            input: {
              path: "secret.rs",
              content:
                "[secret.rs was taken out of the context; its content is not sent again]",
            },
          });
        });

        it("replays a read of a file still in the context whole", () => {
          const messages = inContext([
            said({ n: 1, kind: "user", text: "read it" }),
            call({
              n: 2,
              name: "read_file",
              input: { path: "src/lib.rs" },
              output: "fn main() {}",
            }),
          ]);

          expect(JSON.stringify(messages)).toContain("fn main() {}");
        });
      });

      it("is empty for an empty thread", () => {
        expect(toReplayMessages([])).toEqual([]);
      });
    });
  });
}
