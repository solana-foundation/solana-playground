/* eslint-disable max-params, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import type {
  ActBeat,
  Ask,
  Follow,
  Quote,
  TutorialDefinition,
} from "@/entities/tutorial";
import type { Turn, Wrote } from "@/features/tutorial-conversation";
import { shortKey } from "@/shared/lib/short-key";
import { Button } from "@/shared/ui/button";

import BaseActCard from "./BaseActCard";
import BaseApplyCard from "./BaseApplyCard";
import BaseDeployResultCard, { isDeployResult } from "./BaseDeployResultCard";
import BaseFinishCard from "./BaseFinishCard";
import BaseIntroCard from "./BaseIntroCard";
import BaseQuestionCard, {
  BaseQuestionRecord,
  BaseQuestionWaiting,
} from "./BaseQuestionCard";
import BaseResultCard from "./BaseResultCard";
import BaseSay from "./BaseSay";
import BaseStepDivider from "./BaseStepDivider";
import BaseWinCard from "./BaseWinCard";
import BaseWroteCard from "./BaseWroteCard";
import BaseYouPill from "./BaseYouPill";

/** What the cards ask the conversation to do; each is one engine action */
export interface TurnHandlers {
  start: () => void;
  pick: (beatId: string, option: number) => void;
  hint: (beatId: string) => void;
  skip: (beatId: string) => void;
  /** "Type it myself": the caret to where the answer lands; absent on the phone */
  typeIt?: (beatId: string) => void;
  act: (beatId: string, args?: Record<string, string>) => void;
  /** "Check again" on a run or call devnet has not confirmed */
  recheck: (beatId: string) => void;
  explain: (beatId: string) => void;
  fixMyself: (beatId: string) => void;
  /** "Show me the fix" after an unplanned failure's explanation */
  showFix: (beatId: string) => void;
  next: () => void;
  /** The live step back to how it was entered (an appended wrote card's Reset) */
  restartStep: () => void;
  /** Open a file in the editor with a line in view */
  showLine: (file: string, line: number) => void;
  /** The compiler's location: the line in view with the caret on it */
  revealError: (file: string, line: number) => void;
  /** Open the Call panel; absent until it can be opened (task 4.4) */
  openCall?: () => void;
  /** Open the navigation overlay; absent where there is none */
  openMenu?: () => void;
  /** Open the next tutorial, from the finish card */
  openNextTutorial: () => void;
  /** Open the catalog's Tutorials page, from the finish card */
  allTutorials: () => void;
  /** Copy receipt was pressed on the finish card */
  copyReceipt: () => void;
  /** A copy the clipboard refused */
  copyFailed: (error: unknown) => void;
  /** The apply card's "Apply to <file>", by proposal id */
  apply: (id: string) => void;
  /** The apply card's "Keep it", by proposal id */
  keep: (id: string) => void;
  /** Open the terminal, where a run printed its lines */
  showLog: () => void;
  /** Make the Playground wallet a deploy found missing, then run it again */
  createWallet: (beatId: string) => Promise<unknown> | void;
  /** Sign in with GitHub, for a build the server refused for sign-in */
  signIn: () => Promise<unknown>;
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
  /** The next tutorial's name, for the finish card, or null */
  nextTutorial: string | null;
  /** Someone is signed in: a build refused for sign-in offers Build, not sign-in */
  signedIn?: boolean;
  /** The workspace's program id, which an act's `{program}` names; null before a build */
  programId?: string | null;
  on: TurnHandlers;
}

/** The client file a Call panel pass sends the learner to write the call in */
const CLIENT_FILE = "client/client.ts";

/** A finish chip's quiet button: its label and what it opens */
interface FollowButton {
  label: string;
  onClick: () => void;
}

/**
 * What a chip's `follow` opens, through the handlers the cards already use,
 * or null when it has nowhere to go here: no next tutorial, a handler not
 * given yet, or `showFix`: after the finish there is no failure left to
 * show the fix of.
 */
const followButton = (
  follow: Follow,
  nextTutorial: string | null,
  on: TurnHandlers
): FollowButton | null => {
  const { openCall, openMenu } = on;
  switch (follow) {
    case "nextTutorial":
      return nextTutorial
        ? { label: `Open ${nextTutorial}`, onClick: on.openNextTutorial }
        : null;
    case "openTest":
      return openCall ? { label: "Open Call", onClick: openCall } : null;
    case "showMenu":
      return openMenu ? { label: "Show the menu", onClick: openMenu } : null;
    case "writeClient":
      return {
        label: "Write it in client.ts",
        onClick: () => on.showLine(CLIENT_FILE, 1),
      };
    case "showFix":
      return null;
    default: {
      const never: never = follow;
      return never;
    }
  }
};
/** An act's context with `{program}` as the short program id, or "your program" */
const withProgram = (act: ActBeat, programId: string | null): ActBeat =>
  act.context.includes("{program}")
    ? {
        ...act,
        context: act.context.replace(
          "{program}",
          programId ? shortKey(programId) : "your program"
        ),
      }
    : act;

const linesOf = (content: string | null) => content?.split("\n") ?? [];

/**
 * A block's lines, first to last, as the lesson wrote them: its saved text,
 * else (a save from before the text was kept) those lines as the file holds
 * them now
 */
const previewOf = (
  read: (file: string) => string | null,
  wrote: Wrote
): string[] => {
  const { text } = wrote;
  const content = text ? [] : linesOf(read(wrote.file));
  return wrote.lines
    .map((line, i) => ({ line, code: text ? text[i] : content[line - 1] }))
    .sort((a, b) => a.line - b.line)
    .map(({ code }) => code ?? "");
};

/**
 * What a question's record calls it, so the records down the thread say
 * which question each answers: "Fix" for an ask whose kicker is `Fix it`,
 * else "Q<n>" counting the tutorial's asks whose kicker is `Question`, in
 * order. The kicker is one of the two (`Ask["kicker"]`).
 */
const questionLabel = (definition: TutorialDefinition, ask: Ask) => {
  if (ask.kicker === "Fix it") return "Fix";
  const questions = definition.steps
    .flatMap((s) => s.beats)
    .filter((b): b is Ask => b.kind === "ask" && b.kicker === "Question");
  return `Q${questions.findIndex((b) => b.id === ask.id) + 1}`;
};

/**
 * One turn of the feed as its card: the intro, a divider, the assistant's
 * line, the learner's pill, a wrote card, a question, an act or its result,
 * the win and finish cards. Only the live turn gets the buttons that act;
 * navigation links stay live on every record.
 */
const TurnView = ({
  turn,
  definition,
  live,
  running,
  passed,
  read,
  nextTutorial,
  programId = null,
  signedIn = false,
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
      return <BaseStepDivider objective={turn.objective} />;
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
          fix={
            turn.follow
              ? {
                  done: turn.follow.done,
                  onFix: () => on.showFix(turn.beatId),
                }
              : undefined
          }
        />
      );
    case "hint":
      return <BaseSay text={turn.text} />;
    case "reply": {
      const button = turn.follow
        ? followButton(turn.follow, nextTutorial, on)
        : null;
      return (
        <div className="flex flex-col items-start gap-2">
          <BaseSay text={turn.text} />
          {button && (
            <Button variant="ghost" size="sm" onClick={button.onClick}>
              {button.label}
            </Button>
          )}
        </div>
      );
    }
    case "apply":
      return (
        <BaseApplyCard
          proposal={turn.proposal}
          onApply={() => on.apply(turn.proposal.id)}
          onKeep={() => on.keep(turn.proposal.id)}
        />
      );
    case "you":
      return <BaseYouPill text={turn.text} code={turn.code} />;
    case "wrote": {
      const wrote = turn.wrote;
      return (
        <BaseWroteCard
          wrote={wrote}
          failed={turn.failed}
          preview={wrote ? previewOf(read, wrote) : []}
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
      if (turn.open && live) {
        const { typeIt } = on;
        return (
          <BaseQuestionCard
            ask={turn.ask}
            wrong={turn.wrong}
            hinted={turn.hinted}
            disabled={running}
            onPick={(option) => on.pick(turn.beatId, option)}
            onHint={() => on.hint(turn.beatId)}
            onSkip={() => on.skip(turn.beatId)}
            onTypeIt={typeIt ? () => typeIt(turn.beatId) : undefined}
          />
        );
      }
      if (turn.open || !turn.outcome) {
        return (
          <BaseQuestionWaiting
            ask={turn.ask}
            label={questionLabel(definition, turn.ask)}
          />
        );
      }
      return (
        <BaseQuestionRecord
          ask={turn.ask}
          label={questionLabel(definition, turn.ask)}
          outcome={turn.outcome}
          attempts={turn.attempts}
          wrong={turn.wrong}
        />
      );
    case "act":
      return (
        <BaseActCard
          act={withProgram(turn.act, programId)}
          state={turn.state}
          presses={turn.presses}
          account={turn.account}
          note={turn.note}
          stage={turn.stage}
          took={turn.took}
          disabled={!live || (running && turn.state !== "running")}
          onRun={(args) => on.act(turn.beatId, args)}
        />
      );
    case "result":
      if (isDeployResult(turn.result)) {
        return (
          <BaseDeployResultCard
            result={turn.result}
            // Not `&& live`: a failed deploy stays open while it is the act's
            // latest run, whether it or the Try again card under it is live
            open={turn.open}
            onShowLog={on.showLog}
            onCreateWallet={() => on.createWallet(turn.beatId)}
          />
        );
      }
      return (
        <BaseResultCard
          result={turn.result}
          account={turn.account}
          exists={turn.exists}
          planned={turn.planned}
          open={turn.open && live}
          onExplain={() => on.explain(turn.beatId)}
          onFixMyself={() => on.fixMyself(turn.beatId)}
          onShowLine={on.revealError}
          onRetry={() => on.act(turn.beatId)}
          onRecheck={() => on.recheck(turn.beatId)}
          signedIn={signedIn}
          onSignIn={on.signIn}
        />
      );
    case "win": {
      const index = definition.steps.findIndex((s) => s.id === turn.stepId);
      const next = definition.steps[index + 1]?.title ?? null;
      return (
        <BaseWinCard
          win={turn.win}
          index={index + 1}
          next={turn.last ? null : next}
          via={turn.via}
          reason={turn.reason}
          live={live && !turn.done}
          onNext={on.next}
          onOpenCall={on.openCall}
          onWriteInClient={() => on.showLine(CLIENT_FILE, 1)}
        />
      );
    }
    case "finish":
      return (
        <BaseFinishCard
          headline={definition.finish.headline}
          line={definition.finish.line}
          learned={definition.finish.learned}
          steps={definition.steps.length}
          seconds={turn.seconds}
          receipt={turn.receipt}
          next={nextTutorial}
          onNext={on.openNextTutorial}
          onAllTutorials={on.allTutorials}
          onCopyReceipt={on.copyReceipt}
          onCopyError={on.copyFailed}
        />
      );
  }
};

export default TurnView;

if (import.meta.vitest) {
  const { describe, it, expect, beforeAll } = import.meta.vitest;

  describe("widgets/tutorial-conversation/ui/TurnView", () => {
    let hello: TutorialDefinition;
    beforeAll(async () => {
      hello = (await import("../../../tutorials/hello-anchor/tutorial.json"))
        .default as unknown as TutorialDefinition;
    });

    it("questionLabel counts the questions in order and calls a fix question Fix", () => {
      const asks = hello.steps
        .flatMap((s) => s.beats.concat(s.onFail ?? []))
        .filter((b): b is Ask => b.kind === "ask");
      expect(asks.map((a) => questionLabel(hello, a))).toEqual([
        "Q1",
        "Fix",
        "Q2",
        "Q3",
        "Q4",
      ]);
    });
  });
}
