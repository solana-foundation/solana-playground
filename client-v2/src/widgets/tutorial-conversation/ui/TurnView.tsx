import type { Quote, TutorialDefinition } from "@/entities/tutorial";
import type { Turn } from "@/features/tutorial-conversation";
import BaseActCard from "./BaseActCard";
import BaseIntroCard from "./BaseIntroCard";
import BaseResultCard from "./BaseResultCard";
import BaseSay from "./BaseSay";
import BaseStepDivider from "./BaseStepDivider";
import BaseWroteCard from "./BaseWroteCard";
import BaseYouPill from "./BaseYouPill";
import { AskStandIn, FinishStandIn, WinStandIn } from "./stand-ins";

/** What the cards ask the conversation to do; each is one engine action */
export interface TurnHandlers {
  start: () => void;
  pick: (beatId: string, option: number) => void;
  hint: (beatId: string) => void;
  skip: (beatId: string) => void;
  act: (beatId: string, args?: Record<string, string>) => void;
  explain: (beatId: string) => void;
  fixMyself: (beatId: string) => void;
  next: () => void;
  /** The live step back to how it was entered (an appended wrote card's Reset) */
  restartStep: () => void;
  /** Open a file in the editor with a line in view */
  showLine: (file: string, line: number) => void;
}

export interface TurnViewProps {
  turn: Turn;
  definition: TutorialDefinition;
  /** This is the card that acts; every other card is a record */
  live: boolean;
  /** An act runs: other acts and the question's options wait */
  running: boolean;
  /** The steps passed, by id */
  passed: readonly string[];
  /** A file's content as the workspace holds it now, or null */
  read: (file: string) => string | null;
  on: TurnHandlers;
}

const linesOf = (content: string | null) => content?.split("\n") ?? [];

/**
 * One turn of the feed as its card: the intro, a divider, the assistant's
 * line, the learner's pill, a wrote card, an act or its result, and the
 * stand-ins for the question, win and finish cards. Only the live turn gets
 * the buttons that act; navigation links stay live on every record.
 */
const TurnView = ({
  turn,
  definition,
  live,
  running,
  passed,
  read,
  on,
}: TurnViewProps) => {
  const showQuote = (quote: Quote) => on.showLine(quote.file, quote.line);

  switch (turn.kind) {
    case "intro":
      return (
        <BaseIntroCard
          name={definition.name}
          thumbnail={definition.thumbnail}
          minutes={definition.minutes}
          stepCount={definition.steps.length}
          promise={definition.intro.promise}
          log={definition.intro.log}
          onStart={on.start}
        />
      );
    case "divider":
      return (
        <BaseStepDivider
          index={turn.index}
          count={definition.steps.length}
          title={turn.title}
          objective={turn.objective}
          done={turn.done}
          took={turn.took}
        />
      );
    case "say":
      return (
        <BaseSay
          text={turn.text}
          quote={turn.quote}
          quoted={
            turn.quote
              ? linesOf(read(turn.quote.file))[turn.quote.line - 1] ?? null
              : null
          }
          settled={turn.step !== null && passed.includes(turn.step)}
          onShowQuote={showQuote}
        />
      );
    case "hint":
      return <BaseSay text={turn.text} />;
    case "you":
      return <BaseYouPill text={turn.text} code={turn.code} />;
    case "wrote": {
      const wrote = turn.wrote;
      const content = wrote ? linesOf(read(wrote.file)) : [];
      const preview = wrote
        ? [...wrote.lines]
            .sort((a, b) => a - b)
            .map((line) => content[line - 1] ?? "")
        : [];
      return (
        <BaseWroteCard
          wrote={wrote}
          failed={turn.failed}
          preview={preview}
          onShow={on.showLine}
          onReset={
            turn.step !== null && !passed.includes(turn.step)
              ? on.restartStep
              : undefined
          }
          resetDisabled={running}
        />
      );
    }
    case "ask":
      return (
        <AskStandIn
          ask={turn.ask}
          open={turn.open && live}
          wrong={turn.wrong}
          outcome={turn.outcome}
          attempts={turn.attempts}
          disabled={running}
          onPick={(option) => on.pick(turn.beatId, option)}
          onHint={() => on.hint(turn.beatId)}
          onSkip={() => on.skip(turn.beatId)}
        />
      );
    case "act":
      return (
        <BaseActCard
          act={turn.act}
          state={turn.state}
          note={turn.note}
          stage={turn.stage}
          took={turn.took}
          disabled={!live || (running && turn.state !== "running")}
          onRun={(args) => on.act(turn.beatId, args)}
        />
      );
    case "result":
      return (
        <BaseResultCard
          result={turn.result}
          planned={turn.planned}
          open={turn.open && live}
          onExplain={() => on.explain(turn.beatId)}
          onFixMyself={() => on.fixMyself(turn.beatId)}
          onShowLine={on.showLine}
        />
      );
    case "win": {
      const index = definition.steps.findIndex((s) => s.id === turn.stepId);
      const next = definition.steps[index + 1]?.title ?? null;
      return (
        <WinStandIn
          win={turn.win}
          index={index + 1}
          next={turn.last ? null : next}
          done={turn.done || !live}
          onNext={on.next}
        />
      );
    }
    case "finish":
      return (
        <FinishStandIn
          headline={definition.finish.headline}
          line={definition.finish.line}
        />
      );
  }
};

export default TurnView;
