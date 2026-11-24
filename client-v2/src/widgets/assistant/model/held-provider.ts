import type { Provider } from "../../../views/sidebar/assistant/model/types";
import type { Connection } from "../../../views/sidebar/assistant/store";
import { PgAssistant } from "../../../views/sidebar/assistant/store";

/** What a mounted hook keeps to send on: one provider per connection and conversation */
export interface HeldProvider {
  connection: Connection;
  /** The conversation its history was seeded from */
  threadId: string | null;
  /** `PgAssistant.conversation` when it was seeded */
  conversation: number;
  /**
   * Every file in the context at a send since it was seeded: what its
   * history may hold the content of
   */
  context: ReadonlySet<string>;
  instance: Provider;
}

/**
 * Lets go of `held`'s provider as soon as the store's connection is another
 * one. A provider for a connection the store no longer holds is never sent on
 * again (a send rebuilds on any other connection), and it holds that
 * connection's key: kept, Delete my key would leave the key here until the
 * next send.
 */
export const releaseOnConnectionChange = (held: {
  current: HeldProvider | undefined;
}) =>
  PgAssistant.onDidChange(() => {
    if (held.current?.connection !== PgAssistant.connection) {
      held.current = undefined;
    }
  });

if (import.meta.vitest) {
  const { describe, it, expect, afterEach } = import.meta.vitest;

  describe("widgets/assistant/model/held-provider", () => {
    const connectWith = (apiKey: string) =>
      PgAssistant.connect({
        id: "anthropic",
        apiKey,
        settings: { model: "claude-sonnet-5-5", effort: "high" },
      });

    /** A hook's provider, held for the connection the store has now */
    const heldNow = () => {
      const connection = PgAssistant.connection;
      if (!connection) throw new Error("nothing is connected");
      const held: { current: HeldProvider | undefined } = {
        current: {
          connection,
          // eslint-disable-next-line unicorn/no-null -- `HeldProvider.threadId` is null with no thread open
          threadId: null,
          conversation: PgAssistant.conversation,
          context: new Set(),
          instance: {} as Provider,
        },
      };
      return { held, release: releaseOnConnectionChange(held) };
    };

    afterEach(() => PgAssistant.disconnect());

    it("lets the key go on Delete my key, not at the next send", () => {
      connectWith("k");
      const { held, release } = heldNow();

      PgAssistant.disconnect();

      expect(held.current).toBeUndefined();
      release.dispose();
    });

    it("lets the key go when another key replaces it, before any send", () => {
      connectWith("k");
      const { held, release } = heldNow();

      connectWith("k2");

      expect(held.current).toBeUndefined();
      release.dispose();
    });

    it("keeps the provider through a change that leaves the connection", () => {
      connectWith("k");
      const { held, release } = heldNow();

      PgAssistant.addNotice("unrelated");

      expect(held.current).toBeDefined();
      release.dispose();
    });
  });
}
