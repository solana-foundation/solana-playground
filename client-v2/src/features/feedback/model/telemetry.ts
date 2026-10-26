import { createTracker } from "@/shared/lib/telemetry";
import type { NoParams } from "@/shared/lib/telemetry";
import type { GithubLink } from "../lib/github-links";
import type { Rating } from "./provider";

type FeedbackEvents = {
  /** The feedback form opened. */
  feedback_opened: NoParams;
  /** The reporter accepted a feedback; `rating` is the stars chosen, or `none`. */
  feedback_sent: { rating: Rating | "none" };
  /** The reporter rejected a feedback; what was typed is kept for another try. */
  feedback_failed: NoParams;
  /** The user opened a GitHub link; `link` says which they picked, `from` where. */
  feedback_github_clicked: { link: GithubLink; from: "menu" | "form" };
};

export const feedbackTelemetry = createTracker<FeedbackEvents>();
