import type { MouseEvent } from "react";

import Markdown from "@/components/Markdown";
import { cn } from "@/shared/lib/utils";

import { READ } from "./Prose";

export interface BaseAnswerProps {
  text: string;
  /** A reply, the reason a turn failed, or what the panel did (a stop) */
  tone: "reply" | "error" | "notice";
  /**
   * A link in the reply was pressed. True when the panel showed it itself
   * (a tutorial's doc, as a tab beside the files); false lets the link open
   * as usual, in a new tab
   */
  onLink?: (href: string) => boolean;
}

/** How each tone reads: a reply as the lesson's own lines do */
const TONE: Record<BaseAnswerProps["tone"], string> = {
  reply: READ,
  error: "text-caption text-error",
  notice: "text-caption text-subtle",
};

/**
 * The live assistant's turn in the feed: its Markdown on the column's
 * ground, with no bubble and in the lesson's own type (`inheritFont`), so
 * the two read as one thread (spec "The lesson and the assistant share one
 * thread"). A link `onLink` takes stays in the panel instead of opening a
 * new tab.
 */
const BaseAnswer = ({ text, tone, onLink }: BaseAnswerProps) => {
  // The Markdown draws its links itself; a press is caught on its way down
  const handleClickCapture = (e: MouseEvent<HTMLDivElement>) => {
    // A press with a modifier keeps the browser's own meaning
    const isModified = e.metaKey || e.ctrlKey || e.shiftKey || e.altKey;
    if (!onLink || e.button !== 0 || isModified) {
      return;
    }
    const link =
      e.target instanceof Element ? e.target.closest("a[href]") : undefined;
    const href = link?.getAttribute("href");
    if (!href || !onLink(href)) return;
    e.preventDefault();
    e.stopPropagation();
  };
  return (
    <div
      className={cn("flex flex-col gap-2", TONE[tone])}
      onClickCapture={handleClickCapture}
    >
      <span className="sr-only">Assistant: </span>
      {tone === "reply" ? (
        <Markdown inheritFont>{text}</Markdown>
      ) : (
        <p>{text}</p>
      )}
    </div>
  );
};

export default BaseAnswer;
