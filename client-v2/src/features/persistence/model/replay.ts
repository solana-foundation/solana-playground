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

/** The ids of the records a replay sends: the newest that fit the budget */
const recordsInBudget = (items: readonly ChatItem[]) => {
  const kept = new Set<string>();
  let left = REPLAY_CALL_BUDGET;
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (!isToolCallRecord(item)) continue;
    left -= sizeOf(item.call);
    if (left < 0) break;
    kept.add(item.id);
  }
  return kept;
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
 * Provider-only parts (reasoning signatures, Gemini's thought signatures)
 * were never stored, so a restored thread is honest history rather than a
 * resumed session. Results are cut when stored (`toToolCallRecord`); the live
 * project goes with every turn anyway (`describeProject`), so a file the model
 * read is in front of it again.
 */
export const toReplayMessages = (
  items: readonly ChatItem[]
): ModelMessage[] => {
  const replayed = recordsInBudget(items);
  let calls = 0;
  const messages = items.flatMap((item): ModelMessage[] => {
    if (isToolCallRecord(item) && !replayed.has(item.id)) return [];
    if (isToolCallRecord(item)) {
      const toolCallId = `call_${++calls}`;
      const { name: toolName, input, output, failed } = item.call;
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

    describe("toReplayMessages", () => {
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

      it("is empty for an empty thread", () => {
        expect(toReplayMessages([])).toEqual([]);
      });
    });
  });
}
