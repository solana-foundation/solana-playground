import { reporter } from "@/shared/lib/reporter";
import type { Reporter } from "@/shared/lib/reporter";

export type Rating = 1 | 2 | 3 | 4 | 5;

/** What the form holds when the user submits it */
export interface FeedbackValues {
  message: string;
  contact?: string;
  rating?: Rating;
}

/** Where the slice sends a feedback; a stand-in replaces it in tests */
export interface FeedbackProvider {
  /** Whether a send can succeed in this build */
  available: boolean;
  /** Resolves when the feedback is accepted; rejects when it is not delivered */
  send(values: FeedbackValues, cluster: string): Promise<void>;
}

/** The `source` Sentry files a feedback from this slice under */
export const FEEDBACK_SOURCE = "widget";

/** Sends through `target`, the build's reporter unless a test passes another */
export const reporterFeedbackProvider = (
  target: Reporter = reporter
): FeedbackProvider => ({
  available: target.carried,
  send: ({ message, contact, rating }, cluster) => {
    const tags: Record<string, string | number> = {
      type: "feedback",
      source: FEEDBACK_SOURCE,
      cluster,
    };
    if (rating) tags.rating = rating;

    return target.sendFeedback({
      message,
      name: contact,
      source: FEEDBACK_SOURCE,
      tags,
    });
  },
});

/** Records every send; resolves, or rejects when `fail` is set */
export const memoryFeedbackProvider = ({
  available = true,
  fail = false,
}: { available?: boolean; fail?: boolean } = {}): FeedbackProvider & {
  sent: { values: FeedbackValues; cluster: string }[];
} => {
  const sent: { values: FeedbackValues; cluster: string }[] = [];
  return {
    available,
    sent,
    send: (values, cluster) => {
      sent.push({ values, cluster });
      return fail
        ? Promise.reject(new Error("memoryFeedbackProvider: fail is set"))
        : Promise.resolve();
    },
  };
};

if (import.meta.vitest) {
  const { describe, it, expect, vi } = import.meta.vitest;

  describe("features/feedback/model/provider", () => {
    const fakeReporter = (carried: boolean): Reporter => ({
      carried,
      init: vi.fn(),
      capture: vi.fn(),
      sendFeedback: vi.fn(() => Promise.resolve()),
    });

    it.each([true, false])(
      "should offer sending only where the reporter is carried: %s",
      (carried) => {
        expect(reporterFeedbackProvider(fakeReporter(carried)).available).toBe(
          carried
        );
      }
    );

    it.each<[Rating | undefined, Record<string, string | number>]>([
      [4, { type: "feedback", source: "widget", cluster: "devnet", rating: 4 }],
      [undefined, { type: "feedback", source: "widget", cluster: "devnet" }],
    ])(
      "should hand the reporter the message, contact and tags for rating %s",
      async (rating, tags) => {
        const target = fakeReporter(true);

        await reporterFeedbackProvider(target).send(
          { message: "Deploy is slow", contact: "@fren", rating },
          "devnet"
        );

        expect(target.sendFeedback).toHaveBeenCalledWith({
          message: "Deploy is slow",
          name: "@fren",
          source: "widget",
          tags,
        });
      }
    );

    it("should pass the reporter's rejection on", async () => {
      const target = fakeReporter(true);
      vi.mocked(target.sendFeedback).mockRejectedValue(new Error("500"));

      await expect(
        reporterFeedbackProvider(target).send({ message: "x" }, "devnet")
      ).rejects.toThrow("500");
    });
  });
}
