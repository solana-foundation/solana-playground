export interface BaseAskedBubbleProps {
  text: string;
}

/**
 * What the learner asked the live assistant, or what Explain asked for them:
 * the "you" pill's look, with the text as written, as the assistant panel
 * shows it. Its lines stay lines and a long one wraps, so a build log's
 * fence and backticks read as sent and never push the feed sideways;
 * `BaseYouPill`'s chips are for the lesson's own short picks
 */
const BaseAskedBubble = ({ text }: BaseAskedBubbleProps) => (
  <p className="ml-auto w-fit max-w-[85%] rounded-panel bg-surface-raised px-3 py-2 text-[1rem] leading-[1.5rem] whitespace-pre-wrap text-foreground [overflow-wrap:anywhere]">
    {text}
  </p>
);

export default BaseAskedBubble;
