import { reporter } from "../../../shared/lib/reporter";
import type { Reporter } from "../../../shared/lib/reporter";

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
