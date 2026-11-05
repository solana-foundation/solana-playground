/* eslint-disable layers/curry-order, max-params, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import type { Turn } from "@/features/tutorial-conversation";
import type { ChatItem } from "@/views/sidebar/assistant/store";

/**
 * One entry of the feed: a lesson turn, or an exchange with the live
 * assistant from the workspace's thread (design D2: the two sources merge
 * by time, at render only).
 */
export type FeedEntry =
  | { kind: "lesson"; turn: Turn }
  /** What the learner typed to the assistant; `whole` as a turn's */
  | { kind: "asked"; id: string; at: number; whole: boolean; text: string }
  /** The assistant's answer, or what stopped it */
  | {
      kind: "answer";
      id: string;
      at: number;
      whole: boolean;
      text: string;
      tone: "reply" | "error" | "notice";
    };

/**
 * The lesson's turns and the thread's exchanges after `since` (the last
 * Start over; null shows the whole thread), in one order by time. A lesson
 * turn goes first on a tie, and the thread keeps its own order. Tool rows
 * and settled approvals are left out by choice (a pending one says the turn
 * waits on it): what the assistant does in a
 * tutorial that the learner should see (a hint, a skip, a proposed change)
 * draws the lesson's own card, and its reads show nothing. A reply still
 * empty while its first words stream has nothing to show yet.
 */
export const mergeFeed = (
  turns: readonly Turn[],
  items: readonly ChatItem[],
  since: number | null,
  /** When the save loaded: an exchange from before it renders whole */
  loadedAt = 0
): FeedEntry[] => {
  const exchanges: FeedEntry[] = [];
  for (const item of items) {
    const at = Date.parse(item.createdAt);
    if (!Number.isFinite(at) || (since !== null && at <= since)) continue;
    const entry = entryOf(item, at, at < loadedAt);
    if (entry) exchanges.push(entry);
  }

  const out: FeedEntry[] = [];
  let next = 0;
  for (const turn of turns) {
    while (next < exchanges.length && atOf(exchanges[next]) < turn.at) {
      out.push(exchanges[next]);
      next += 1;
    }
    out.push({ kind: "lesson", turn });
  }
  return out.concat(exchanges.slice(next));
};

/**
 * Whether the assistant has answered since `since` (the last Start over; null
 * reads the whole thread): in words, or with a tool it ran, since a turn that
 * only opens the menu writes nothing
 */
export const hasAnswered = (
  items: readonly ChatItem[],
  since: number | null
): boolean =>
  items.some((item) => {
    const at = Date.parse(item.createdAt);
    if (!Number.isFinite(at) || (since !== null && at <= since)) return false;
    return (
      item.kind === "tool" || (item.kind === "assistant" && !!item.text.trim())
    );
  });

/** What a pending approval reads as in the tutorial feed */
export const APPROVAL_WAITING =
  "The assistant asked to change the project, which a tutorial does not " +
  "allow, so it is declined.";

const atOf = (entry: FeedEntry) =>
  entry.kind === "lesson" ? entry.turn.at : entry.at;

const entryOf = (
  item: ChatItem,
  at: number,
  whole: boolean
): FeedEntry | null => {
  switch (item.kind) {
    case "user":
      return { kind: "asked", id: item.id, at, whole, text: item.text };
    case "assistant":
      return item.text.trim()
        ? {
            kind: "answer",
            id: item.id,
            at,
            whole,
            text: item.text,
            tone: "reply",
          }
        : null;
    case "error":
    case "notice":
      return {
        kind: "answer",
        id: item.id,
        at,
        whole,
        text: item.text,
        tone: item.kind,
      };
    case "tool":
      return null;
    case "approval":
      // A turn begun before the tutorial opened can still ask to write; the
      // feed declines it at once (`useAssistantMode`), and says so meanwhile
      return item.status === "pending"
        ? {
            kind: "answer",
            id: item.id,
            at,
            whole,
            text: APPROVAL_WAITING,
            tone: "notice",
          }
        : null;
    default: {
      const never: never = item;
      return never;
    }
  }
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("widgets/tutorial-conversation/model/merge", () => {
    describe("hasAnswered", () => {
      const createdAt = new Date(2000).toISOString();
      const tool: ChatItem = {
        id: "t",
        createdAt,
        kind: "tool",
        label: "opened the menu",
      };
      const reply: ChatItem = {
        id: "a",
        createdAt,
        kind: "assistant",
        text: "A PDA is",
      };

      it("counts a written reply or a tool the assistant ran", () => {
        expect(hasAnswered([reply], null)).toBe(true);
        expect(hasAnswered([tool], null)).toBe(true);
      });

      it("does not count a reply with no words yet, or the learner's message", () => {
        expect(
          hasAnswered(
            [{ id: "a", createdAt, kind: "assistant", text: " " }],
            null
          )
        ).toBe(false);
        expect(
          hasAnswered(
            [{ id: "u", createdAt, kind: "user", text: "the menu" }],
            null
          )
        ).toBe(false);
      });

      it("does not count an item whose time cannot be read, as the feed drops it", () => {
        expect(
          hasAnswered(
            [
              {
                id: "t",
                createdAt: "not a date",
                kind: "tool",
                label: "opened the menu",
              },
            ],
            null
          )
        ).toBe(false);
      });

      it("does not count what came before the last Start over", () => {
        expect(hasAnswered([reply, tool], 2000)).toBe(false);
        expect(hasAnswered([reply, tool], 1999)).toBe(true);
      });
    });

    const say = (id: string, at: number): Turn => ({
      id,
      kind: "say",
      step: "write-program",
      at,
      whole: false,
      beatId: id,
      text: id,
    });
    const iso = (at: number) => new Date(at).toISOString();
    const user = (id: string, at: number, text: string): ChatItem => ({
      id,
      createdAt: iso(at),
      kind: "user",
      text,
    });
    const reply = (id: string, at: number, text: string): ChatItem => ({
      id,
      createdAt: iso(at),
      kind: "assistant",
      text,
    });
    const ids = (entries: FeedEntry[]) =>
      entries.map((e) => (e.kind === "lesson" ? e.turn.id : e.id));

    it("puts the exchanges between the lesson's turns by time", () => {
      expect(
        ids(
          mergeFeed(
            [say("a", 1000), say("b", 3000), say("c", 5000)],
            [user("q", 2000, "what?"), reply("r", 2500, "This.")],
            null
          )
        )
      ).toEqual(["a", "q", "r", "b", "c"]);
    });

    it("puts the lesson first on a tie, and keeps late exchanges at the end", () => {
      expect(
        ids(
          mergeFeed(
            [say("a", 1000)],
            [user("q", 1000, "now?"), reply("r", 9000, "Yes.")],
            null
          )
        )
      ).toEqual(["a", "q", "r"]);
    });

    it("shows only the exchanges after Start over", () => {
      expect(
        ids(
          mergeFeed(
            [say("a", 6000)],
            [user("old", 2000, "before"), user("new", 7000, "after")],
            5000
          )
        )
      ).toEqual(["a", "new"]);
    });

    it("renders an exchange from before the load whole", () => {
      const [before, after] = mergeFeed(
        [],
        [user("q", 1000, "old"), user("r", 3000, "new")],
        null,
        2000
      );
      expect(before).toMatchObject({ id: "q", whole: true });
      expect(after).toMatchObject({ id: "r", whole: false });
    });

    it("says a pending approval keeps the turn waiting, and hides a settled one", () => {
      const approval = (
        id: string,
        status: "pending" | "denied"
      ): ChatItem => ({
        id,
        createdAt: iso(2000),
        kind: "approval",
        request: { type: "patch", path: "src/lib.rs", before: "a", after: "b" },
        status,
      });
      expect(
        mergeFeed(
          [],
          [approval("a1", "pending"), approval("a2", "denied")],
          null
        )
      ).toEqual([
        {
          kind: "answer",
          id: "a1",
          at: 2000,
          whole: false,
          text: APPROVAL_WAITING,
          tone: "notice",
        },
      ]);
    });

    it("hides tool calls and a reply with no words yet", () => {
      const tool: ChatItem = {
        id: "t",
        createdAt: iso(2000),
        kind: "tool",
        label: "read lib.rs",
      };
      const failed: ChatItem = {
        id: "e",
        createdAt: iso(4000),
        kind: "error",
        text: "The model refused.",
      };
      expect(
        mergeFeed([], [tool, reply("empty", 3000, " "), failed], null)
      ).toEqual([
        {
          kind: "answer",
          id: "e",
          at: 4000,
          whole: false,
          text: "The model refused.",
          tone: "error",
        },
      ]);
    });
  });
}
