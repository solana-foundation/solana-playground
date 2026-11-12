/* eslint-disable layers/curry-order, max-params, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import type { TutorialDefinition } from "@/entities/tutorial";
import type {
  ConversationView,
  Landing,
} from "@/features/tutorial-conversation";
import { landingFor, stepOfBeat } from "@/features/tutorial-conversation";

import { linesNow } from "./lines-now";

/**
 * What the feed lights in a file of the editor (`tutorial-workspace`'s
 * `LineMarks`, less the failed build's line, which the workspace reads
 * itself): the lines the assistant last wrote there, and where the open
 * question's answer lands. A copy of that shape, not an import: one widget
 * never imports another, and `views/flow/Flow.tsx` joins the two, where the
 * type checker holds them to the same fields.
 * TODO(tutorial-flow-v2): move the shared shape down to `entities/tutorial`
 * if a third reader appears.
 */
export interface FeedMarks {
  readonly written: readonly number[];
  /** The write was posted since the page loaded: its lines flash in once */
  readonly arriving: boolean;
  readonly landing: Landing | null;
}

const NONE: FeedMarks = Object.freeze({
  written: Object.freeze([]),
  arriving: false,
  landing: null,
});

/**
 * The marks for each file, read off the feed's view. Written lines are the
 * last wrote card's in this file on the live step; a write from an earlier
 * step is history, not "what the assistant just did". The landing is the
 * live question's dry run (`landingFor`), as the write would place it now;
 * a file that cannot be read, or a question its step does not know, gets no
 * landing rather than a guessed one at the top of an empty file. Nothing is
 * live after the finish, and nothing is marked.
 */
export const marksOf =
  (
    definition: TutorialDefinition,
    view: ConversationView,
    read: (file: string) => string | null
  ) =>
  (file: string): FeedMarks => {
    const live = view.live;
    const step = live?.step ?? null;
    if (step === null) return NONE;
    const wrote = [...view.turns]
      .reverse()
      .find(
        (t) =>
          t.kind === "wrote" &&
          t.step === step &&
          t.wrote !== null &&
          t.wrote.file === file
      );
    // Where the block is now, as its card names it
    const saved =
      wrote?.kind === "wrote" && wrote.wrote ? wrote.wrote.lines : [];
    const written =
      wrote?.kind === "wrote" && wrote.wrote
        ? linesNow(wrote.wrote, read(file) ?? undefined)
        : [];
    // A block arrives where it landed: once the learner moved it, its lines
    // are lit without flashing in again
    const isMoved = written.some((line, i) => line !== saved[i]);

    let landing: Landing | null = null;
    if (live?.kind === "ask" && live.open && live.ask.writes?.file === file) {
      const at = stepOfBeat(definition, live.beatId);
      const code = read(file);
      if (at && code !== null) {
        landing = landingFor(
          code,
          live.ask.writes.block,
          at.target[file],
          at.start[file] ?? ""
        );
      }
    }

    if (!written.length && !landing) return NONE;
    return {
      written,
      arriving:
        written.length > 0 && wrote !== undefined && !wrote.whole && !isMoved,
      landing,
    };
  };
