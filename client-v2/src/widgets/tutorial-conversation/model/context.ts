/* eslint-disable unicorn/no-null -- tutorial flow v2 predates this rule; cleanup tracked from SF#94 */
import type {
  ActBeat,
  ActionWord,
  TutorialDefinition,
} from "@/entities/tutorial";
import type {
  ConversationProgress,
  RunRecord,
  RunResult,
  Turn,
} from "@/features/tutorial-conversation";

import { nextStepLabel, QUESTION_BUTTONS, stepDoneLabel } from "./card-labels";

/**
 * The names of the tutorial mode's own tools, declared once: the tools
 * (`tutorialMode`) and the prose that tells the model to call them use these
 */
export const TOOLS = {
  openMenu: "open_menu",
  hint: "hint",
  skip: "skip",
  propose: "propose_change",
} as const;

/**
 * How an answer before Start ends: the lesson is one press or one word away.
 * Names the intro card's button and a start word (`route.ts`), so it changes
 * with them
 */
export const BEGIN_INVITATION =
  "When you're ready, press Start step 1 or type start.";

export interface TutorialFacts {
  definition: TutorialDefinition;
  progress: ConversationProgress;
  /** The card that acts, or null */
  live: Turn | null;
  /** Workspace paths of the open tabs */
  openFiles: readonly string[];
  /** The tab in front, if any */
  currentFile: string | null;
}

/**
 * The tutorial as the assistant's context: where the learner is, what the
 * step asks and the steps still to come, where the lesson's actions are and
 * what the terminal runs, the card the step waits on, the last result, the
 * files and the docs it may link, and what it may and may not do here. Copy
 * from the definition, facts from the save.
 */
export const describeTutorial = (facts: TutorialFacts): string => {
  const { definition, progress, live } = facts;
  const lines = [
    `The learner is in the tutorial "${definition.name}" in Solana Playground, ` +
      `${definition.steps.length} steps, on devnet.`,
    whereOf(definition, progress),
    WHERE_ACTIONS_ARE,
    WHAT_THE_TERMINAL_RUNS,
  ];
  if (live?.kind === "ask" && live.open) {
    lines.push(
      `A question is open: "${textOf(live.ask.question)}". The step waits ` +
        "on its question card in this chat first: point the learner to " +
        `answer it there, or to its ${questionButtons(live)} button. ` +
        "The step's next card appears in this chat once it is answered. " +
        `Do not give its answer away; ${TOOLS.hint} posts the lesson's own ` +
        `hint, and ${TOOLS.skip} skips it, as its buttons do.`
    );
  }
  if (live?.kind === "act") lines.push(whereActIs(live));
  if (live?.kind === "win") lines.push(whereNextIs(definition, live));
  if (live?.kind === "result" && live.open) {
    lines.push(
      "The step waits on the failed result's card in this chat: point the " +
        "learner to its buttons."
    );
  }
  const last = lastRun(progress);
  if (last) lines.push(`The last result: ${describeRun(last)}.`);
  if (facts.openFiles.length) {
    lines.push(
      `Open files: ${facts.openFiles.join(", ")}` +
        (facts.currentFile ? `; in front: ${facts.currentFile}.` : ".")
    );
  }
  if (definition.docs?.length) {
    lines.push(
      "This tutorial's doc pages, which open beside the code: " +
        definition.docs.map((d) => `${d.title} (${d.url})`).join("; ") +
        ". When one of them covers what you explain, link it as a Markdown " +
        "link with its address exactly as listed. Link another site only " +
        "for what none of them covers, and one page at most per answer."
    );
  }
  lines.push(
    "In this tutorial you cannot change files, build, deploy or send " +
      `transactions. To change code, propose one line with ${TOOLS.propose}; ` +
      "the learner applies it or keeps their own. To show the steps, use " +
      `${TOOLS.openMenu}. You never judge whether a step passed: the lesson does.`
  );
  if (progress.cursor.kind === "intro") {
    lines.push(
      "Before Start, answer what they asked, then end your reply with this " +
        `invitation to begin: "${BEGIN_INVITATION}" Write it after a tool too: ` +
        `${TOOLS.openMenu} never ends your turn here.`
    );
  }
  return lines.join("\n");
};

/**
 * The tutorial now, sent after the thread's history with the newest message
 * (`AssistantMode.now`): where the learner is and the card the step waits
 * on. When the learner asked "what now?" again, the model repeated its
 * earlier answers from the history over the context before it ("press Start
 * step 1" at a live Build card, HOO-2823). Before Start it repeats the
 * invitation to begin: the note is never stored, so it cannot outlive Start
 * as the menu's result did.
 */
export const describeNow = ({
  definition,
  progress,
  live,
}: Pick<TutorialFacts, "definition" | "progress" | "live">): string => {
  const lines = [`The tutorial now: ${nowOf(definition, progress)}`];
  const waits = waitsOn(definition, live);
  if (waits) lines.push(waits);
  lines.push(
    "Earlier turns describe the tutorial as it was then: answer from this " +
      "and the tutorial context, not from them."
  );
  return lines.join(" ");
};

const nowOf = (
  definition: TutorialDefinition,
  progress: ConversationProgress
): string => {
  const { cursor } = progress;
  if (cursor.kind === "intro") {
    return `they have not pressed Start yet: end your reply with "${BEGIN_INVITATION}"`;
  }
  if (cursor.kind === "finished") return "they finished every step.";
  const i = definition.steps.findIndex((s) => s.id === cursor.stepId);
  const step = definition.steps[i];
  if (!step) return "they are in a step this tutorial no longer has.";
  return `step ${i + 1} of ${definition.steps.length}, ${step.title}.`;
};

/**
 * What the live card waits for (an open question, an act's button, a done
 * step's Next, a failed result), or that the last step is done; "" for any
 * other card or none. A win on a step the definition no longer has reads as
 * the last, as in `whereNextIs`
 */
const waitsOn = (definition: TutorialDefinition, live: Turn | null): string => {
  if (live?.kind === "ask" && live.open) {
    return `It waits on the open question: "${textOf(live.ask.question)}".`;
  }
  if (live?.kind === "act") {
    return (
      `It waits for the "${live.act.button}" button on the ` +
      `"${live.act.title}" card.${actStateOf(live)}`
    );
  }
  if (live?.kind === "win") {
    const { next } = nextAfter(definition, live);
    if (!next) return "The last step is done.";
    return (
      "The step is done: the next one opens from the " +
      `"${nextStepLabel(next.title)}" button.`
    );
  }
  if (live?.kind === "result" && live.open) {
    return "It waits on the failed result's card.";
  }
  return "";
};

/**
 * The foot buttons an open question's card shows (`BaseQuestionCard`): Hint
 * until it was taken, "Type it myself" for a question that writes, which the
 * phone layout (every viewport under the frame's width, `phoneLayoutOf`)
 * leaves out, and Skip always
 */
const questionButtons = (live: Extract<Turn, { kind: "ask" }>): string => {
  const buttons: string[] = [];
  const { hint, typeIt, skip } = QUESTION_BUTTONS;
  if (!live.hinted) buttons.push(hint);
  if (live.ask.writes) buttons.push(`${typeIt} (only on a wide screen)`);
  if (!buttons.length) return skip;
  return `${buttons.join(", ")} or ${skip}`;
};

const textOf = (text: string | { text: string }) =>
  typeof text === "string" ? text : text.text;

const whereOf = (
  definition: TutorialDefinition,
  progress: ConversationProgress
): string => {
  const { cursor } = progress;
  if (cursor.kind === "intro") {
    return "They have not started yet: the intro card shows the finished program.";
  }
  if (cursor.kind === "finished") {
    return "They finished every step.";
  }
  const i = definition.steps.findIndex((s) => s.id === cursor.stepId);
  const step = definition.steps[i];
  if (!step) return "They are in a step this tutorial no longer has.";
  const passed = progress.passed.includes(step.id) ? " It has passed." : "";
  const n = definition.steps.length;
  const after = definition.steps
    .slice(i + 1)
    .map((s, j) => `${s.title} (${i + j + 2} of ${n})`);
  const rest = after.length
    ? ` Steps after this one: ${after.join(", ")}.`
    : " This is the last step.";
  return (
    `Step ${i + 1} of ${n}: ${step.title}. ` +
    `Objective: ${step.objective}. The step's file: ${step.file}.${passed}${rest}`
  );
};

/**
 * The composer's words that press the live card (`actionFor` in the
 * conversation's `route.ts`): every `ActionWord` but the start words, which
 * the type checks both ways. The list itself stays out of the conversation's
 * entry, whose import loads code that needs the build's globals
 */
const CARD_WORDS: Record<Exclude<ActionWord, "start">, true> = {
  build: true,
  deploy: true,
  run: true,
  call: true,
  next: true,
  explain: true,
};

/** "a, b or c" */
const listOf = (words: readonly string[]): string =>
  words.length > 1
    ? `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`
    : words.join("");

/**
 * Where the lesson's actions are, in every tutorial context: the cards, the
 * composer's words that press the live one (`CARD_WORDS`), and the work
 * area's two other ways.
 * Asked "how do I build?" or "what now?", the assistant sent learners to a
 * Build or Deploy action on the stage bar, which a tutorial's frame does not
 * draw, nor its Write/Build/Deploy/Interact tabs (HOO-2755, HOO-2801): the
 * general assistant context describes a project's work area, not a
 * tutorial's.
 */
const WHERE_ACTIONS_ARE =
  "The lesson's actions (build, deploy, airdrop, run, call) are buttons on " +
  "cards in the tutorial feed, in this chat: the work area has no Build, " +
  "Deploy or Interact action or tab in a tutorial. A message that is only " +
  `one of the words ${listOf(Object.keys(CARD_WORDS))} presses the live ` +
  "card's button too, except while a question is open, while the card " +
  "runs, or on a call card with a field to fill. In the work area, only " +
  "the Call panel in its head, once the program is deployed, and running " +
  "the client file act.";

/**
 * What the terminal runs: Playground's own commands (`src/commands`), not a
 * shell. Asked "what now?", the assistant sent a learner to `yarn run test`
 * and a test file the tutorial does not ship (HOO-2801)
 */
const WHAT_THE_TERMINAL_RUNS =
  "The terminal runs Playground's own commands (build, deploy, run, test, " +
  "airdrop, solana, anchor, spl-token, help and a few more), not a shell: " +
  "there is no yarn, npm or npx. In a tutorial a command typed there " +
  "passes no step, except where this context says so.";

/**
 * What else, if anything, runs the live act outside its card. That the work
 * area has no Build or Deploy is said once, in `WHERE_ACTIONS_ARE`, not
 * here. A build or a deploy the lesson reads runs from the card alone: the
 * terminal's `build` compiles but passes no step. A call has the Call panel
 * and a run has the client file too (`PassedVia`).
 */
const BESIDES_THE_CARD: Record<ActBeat["act"], string> = {
  build:
    "It is the only build the lesson reads: a build typed in the terminal passes no step.",
  deploy:
    "It is the only deploy the lesson reads: a deploy typed in the terminal passes no step.",
  buildDeploy:
    "It is the only build and deploy the lesson reads: the terminal's commands pass no step.",
  airdrop: "It is the only way to request the airdrop in the lesson.",
  run: "Running the client file from the editor passes the step too.",
  call: "The Call panel in the work area's head sends the same instruction and passes the step too.",
};

/**
 * Where the control that runs the step's act sits: its card in the tutorial
 * feed, this chat, with what else runs it (`BESIDES_THE_CARD`) and how the
 * card stands: live, running, or interrupted by a reload, after which the
 * learner presses it again; nothing resumes on its own.
 */
const whereActIs = (live: Extract<Turn, { kind: "act" }>): string =>
  `The step waits for the "${live.act.button}" button on the ` +
  `"${live.act.title}" card in the tutorial feed, in this chat. ` +
  `${BESIDES_THE_CARD[live.act.act]} Point the learner to that card.` +
  actStateOf(live);

/** How an act card stands, with a leading space, or "" when it is live */
const actStateOf = (live: Extract<Turn, { kind: "act" }>): string => {
  if (live.state === "running") return " It is running now.";
  if (live.state === "interrupted") {
    return " A reload interrupted its last run; pressing it runs it again.";
  }
  return "";
};

/**
 * Where the learner goes on from a passed step: the win card's "Next:
 * <step>" button (`BaseWinCard`), or, after the last step or a step the
 * definition no longer has, the finish card that follows by itself
 */
const whereNextIs = (
  definition: TutorialDefinition,
  live: Extract<Turn, { kind: "win" }>
): string => {
  const { i, next } = nextAfter(definition, live);
  if (!next) {
    return "The last step is done: the finish card follows in this chat by itself.";
  }
  return (
    `The step is done: the "${stepDoneLabel(i + 1)}" card in this chat has ` +
    `the "${nextStepLabel(
      next.title
    )}" button, which opens the next step. Point the ` +
    "learner to that button."
  );
};

/**
 * The passed step's index and the step its Next button opens: none after the
 * last step, or after a step the definition no longer has
 */
const nextAfter = (
  definition: TutorialDefinition,
  live: Extract<Turn, { kind: "win" }>
) => {
  const i = definition.steps.findIndex((s) => s.id === live.stepId);
  const next = i === -1 || live.last ? undefined : definition.steps[i + 1];
  return { i, next };
};

/** The latest run to start, of any act, that has ended */
const lastRun = (progress: ConversationProgress): RunRecord | null => {
  let last: RunRecord | null = null;
  for (const runs of Object.values(progress.runs)) {
    for (const run of runs) {
      if (run.status === "interrupted" || run.status === "started") continue;
      if (!last || run.at >= last.at) last = run;
    }
  }
  return last;
};

const describeRun = (run: RunRecord): string => {
  if (run.status === "interrupted" || run.status === "started") {
    return "a run that did not end";
  }
  return describeResult(run.result);
};

const describeResult = (r: RunResult): string => {
  if (r.ok) {
    if (r.act === "build") return "the build passed";
    if (r.act === "deploy" || r.act === "buildDeploy") {
      return `the program deployed at ${r.programId}`;
    }
    if (r.act === "run" || r.act === "call") {
      return r.line
        ? `the ${r.act} landed, logging "${r.line}"`
        : `the ${r.act} landed`;
    }
    return "the act landed";
  }
  if (r.act === "build") {
    return r.error
      ? `the build failed: ${r.error.code} at ${r.error.file}:${r.error.line}, ${r.error.message}`
      : "the build failed";
  }
  return `the ${r.act} failed: ${r.message}`;
};

if (import.meta.vitest) {
  const { describe, it, expect, beforeAll } = import.meta.vitest;

  describe("widgets/tutorial-conversation/model/context", () => {
    /** The key phrases of where the actions are and what the terminal runs */
    const expectEveryContext = (text: string) => {
      expect(text).toContain("buttons on cards in the tutorial feed");
      expect(text).toContain("no Build, Deploy or Interact action or tab");
      expect(text).toContain(
        "build, deploy, run, call, next or explain presses the live card's button"
      );
      expect(text).toContain("except while a question is open");
      expect(text).toContain("on a call card with a field to fill");
      expect(text).toContain(
        "only the Call panel in its head, once the program is deployed"
      );
      expect(text).toContain("running the client file");
      expect(text).toContain("Playground's own commands");
      expect(text).toContain("there is no yarn, npm or npx");
      expect(text).toContain("a command typed there passes no step");
    };
    let hello: TutorialDefinition;
    beforeAll(async () => {
      hello = (await import("../../../tutorials/hello-anchor/tutorial.json"))
        .default as unknown as TutorialDefinition;
    });

    /** A save before Start, named field by field; tests set what they need */
    const freshProgress = (): ConversationProgress => ({
      version: 1,
      passed: [],
      finishedAt: null,
      startedAt: null,
      restartedAt: null,
      cursor: { kind: "intro" },
      beats: {},
      runs: {},
      times: {},
      said: [],
      proposals: [],
      accounts: {},
    });

    it("says where the learner is, what the step asks and what it may do", () => {
      const progress = freshProgress();
      progress.startedAt = 1000;
      progress.cursor = {
        kind: "step",
        stepId: hello.steps[1].id,
        beat: 0,
        fail: false,
      };
      const text = describeTutorial({
        definition: hello,
        progress,
        live: null,
        openFiles: ["programs/hello/src/lib.rs"],
        currentFile: "programs/hello/src/lib.rs",
      });
      expect(text).toContain(`Step 2 of 4: ${hello.steps[1].title}.`);
      expect(text).toContain(`Objective: ${hello.steps[1].objective}.`);
      expect(text).toContain("in front: programs/hello/src/lib.rs");
      expect(text).toContain("you cannot change files, build, deploy");
      expectEveryContext(text);
      expect(text).toContain(
        `Steps after this one: ${hello.steps[2].title} (3 of 4), ${hello.steps[3].title} (4 of 4).`
      );
      expect(text).not.toContain("This is the last step.");
      expect(text).not.toContain(BEGIN_INVITATION);
    });

    it("names the step after the current one, and says when it is the last", () => {
      const at = (index: number) => {
        const progress = freshProgress();
        progress.startedAt = 1000;
        progress.cursor = {
          kind: "step",
          stepId: hello.steps[index].id,
          beat: 0,
          fail: false,
        };
        return describeTutorial({
          definition: hello,
          progress,
          live: null,
          openFiles: [],
          currentFile: null,
        });
      };
      const third = at(2);
      expect(third).toContain(
        `Steps after this one: ${hello.steps[3].title} (4 of 4).`
      );
      expect(third).not.toContain("This is the last step.");
      expect(at(3)).toContain("This is the last step.");
      expect(at(3)).not.toContain("Steps after this one");
    });

    it("points to the live act's card, says what else runs it, and that an interrupted card is pressed again", () => {
      const build = hello.steps[0].beats.find(
        (b): b is ActBeat => b.kind === "act"
      );
      if (!build) throw new Error("Hello Anchor has no act in step 1");
      const call: ActBeat = {
        kind: "act",
        id: "s9.call",
        act: "call",
        title: "Call hello",
        context: "Sends hello",
        button: "Call",
        call: { instruction: "hello" },
      };
      const progress = freshProgress();
      progress.startedAt = 1000;
      progress.cursor = {
        kind: "step",
        stepId: hello.steps[0].id,
        beat: 4,
        fail: false,
      };
      const card = (
        act: ActBeat,
        state: import("@/features/tutorial-conversation").ActState
      ): Turn => ({
        id: act.id,
        kind: "act",
        step: hello.steps[0].id,
        at: 2000,
        whole: true,
        beatId: act.id,
        act,
        state,
        presses: [],
        note: null,
        stage: null,
        took: null,
      });
      const facts = (live: Turn) => ({
        definition: hello,
        progress,
        live,
        openFiles: [],
        currentFile: null,
      });
      const text = describeTutorial(facts(card(build, "live")));
      expect(text).toContain(
        `The step waits for the "${build.button}" button on the ` +
          `"${build.title}" card in the tutorial feed, in this chat.`
      );
      expect(text).toContain(
        "It is the only build the lesson reads: a build typed in the terminal passes no step."
      );
      expect(text.split("the work area has no")).toHaveLength(2);
      expect(text).not.toContain("It is running now.");
      expect(text).not.toContain("A reload interrupted");
      expect(describeTutorial(facts(card(build, "running")))).toContain(
        "It is running now."
      );
      expect(describeTutorial(facts(card(build, "interrupted")))).toContain(
        "A reload interrupted its last run; pressing it runs it again."
      );
      for (const act of hello.steps.flatMap((s) => s.beats)) {
        if (act.kind !== "act" || act.act === "build") continue;
        const other = describeTutorial(facts(card(act, "live")));
        expect(other.split("the work area has no")).toHaveLength(2);
      }
      const called = describeTutorial(facts(card(call, "live")));
      expect(called).toContain("The Call panel in the work area's head");
      expect(called).not.toContain("only way");
    });

    it("points an open question to its card, guards its answer and lists the tutorial's docs", () => {
      const ask = hello.steps[0].beats.find(
        (b): b is import("@/entities/tutorial").Ask => b.kind === "ask"
      );
      if (!ask) throw new Error("Hello Anchor has no question in step 1");
      const asked = (
        question: import("@/entities/tutorial").Ask,
        { hinted }: { hinted: boolean }
      ): Turn => ({
        id: question.id,
        kind: "ask",
        step: hello.steps[0].id,
        at: 1,
        whole: false,
        beatId: question.id,
        ask: question,
        open: true,
        wrong: [],
        hinted,
        writeFailed: false,
        outcome: null,
        attempts: 0,
      });
      const live = asked(ask, { hinted: false });
      const withDocs: TutorialDefinition = {
        version: hello.version,
        name: hello.name,
        description: hello.description,
        authors: hello.authors,
        level: hello.level,
        framework: hello.framework,
        languages: hello.languages,
        thumbnail: hello.thumbnail,
        minutes: hello.minutes,
        intro: hello.intro,
        steps: hello.steps,
        finish: hello.finish,
        docs: [
          {
            title: "The program log",
            url: "https://solana.com/docs/programs/debugging",
            file: "log.md",
          },
        ],
      };
      const text = describeTutorial({
        definition: withDocs,
        progress: freshProgress(),
        live,
        openFiles: [],
        currentFile: null,
      });
      expect(text).toContain("The step waits on its question card");
      expect(text).toContain(
        "Hint, Type it myself (only on a wide screen) or Skip button"
      );
      expect(text).toContain("next card appears in this chat");
      expect(
        describeTutorial({
          definition: hello,
          progress: freshProgress(),
          live: asked(ask, { hinted: true }),
          openFiles: [],
          currentFile: null,
        })
      ).toContain("its Type it myself (only on a wide screen) or Skip button");
      // Step 2's question writes nothing: no Type it myself, and no Hint once taken
      const deployAsk = hello.steps[1].beats.find(
        (b): b is import("@/entities/tutorial").Ask => b.kind === "ask"
      );
      if (!deployAsk) throw new Error("Hello Anchor has no question in step 2");
      const buttonsOf = ({ hinted }: { hinted: boolean }) =>
        describeTutorial({
          definition: hello,
          progress: freshProgress(),
          live: asked(deployAsk, { hinted }),
          openFiles: [],
          currentFile: null,
        });
      expect(buttonsOf({ hinted: false })).toContain("its Hint or Skip button");
      expect(buttonsOf({ hinted: true })).toContain("its Skip button");
      expectEveryContext(text);
      expect(text).toContain("Do not give its answer away");
      expect(text).toContain(`${TOOLS.hint} posts the lesson's own hint`);
      expect(text).toContain(
        "This tutorial's doc pages, which open beside the code: The program log (https://solana.com/docs/programs/debugging). When one of them covers what you explain, link it as a Markdown link with its address exactly as listed. Link another site only for what none of them covers, and one page at most per answer."
      );
    });

    it("points a passed step to its win card's Next button, and the last one to the finish", () => {
      const progress = freshProgress();
      progress.startedAt = 1000;
      progress.passed = [hello.steps[0].id];
      progress.cursor = {
        kind: "step",
        stepId: hello.steps[0].id,
        beat: 5,
        fail: false,
      };
      const win = (stepId: string, { last }: { last: boolean }): Turn => ({
        id: `${stepId}.win`,
        kind: "win",
        step: stepId,
        at: 2000,
        whole: true,
        stepId,
        win: { id: `${stepId}.win`, headline: "Done", line: "Done." },
        done: false,
        took: 1000,
        via: "chat",
        last,
      });
      const text = describeTutorial({
        definition: hello,
        progress,
        live: win(hello.steps[0].id, { last: false }),
        openFiles: [],
        currentFile: null,
      });
      expect(text).toContain(`the "Step 1 done" card in this chat`);
      expect(text).toContain(`"Next: ${hello.steps[1].title}" button`);
      expectEveryContext(text);
      const lastStep = hello.steps[hello.steps.length - 1].id;
      expect(
        describeTutorial({
          definition: hello,
          progress,
          live: win(lastStep, { last: true }),
          openFiles: [],
          currentFile: null,
        })
      ).toContain("the finish card follows in this chat");
      // The last step without its flag, and a step the tutorial no longer has
      for (const stepId of [lastStep, "gone"]) {
        expect(
          describeTutorial({
            definition: hello,
            progress,
            live: win(stepId, { last: false }),
            openFiles: [],
            currentFile: null,
          })
        ).toContain("the finish card follows in this chat");
      }
    });

    it("points an open failed result to its card's buttons", () => {
      const progress = freshProgress();
      progress.startedAt = 1000;
      progress.cursor = {
        kind: "step",
        stepId: hello.steps[0].id,
        beat: 3,
        fail: true,
      };
      const live: Turn = {
        id: "s1.build.result",
        kind: "result",
        step: hello.steps[0].id,
        at: 2000,
        whole: true,
        beatId: "s1.build",
        act: "build",
        result: {
          act: "build",
          ok: false,
          seconds: 1,
          reason: "compiler",
          error: null,
          log: "",
        },
        took: 1000,
        planned: null,
        open: true,
      };
      expect(
        describeTutorial({
          definition: hello,
          progress,
          live,
          openFiles: [],
          currentFile: null,
        })
      ).toContain("The step waits on the failed result's card");
    });

    it("names the last result, a failed build with its error", () => {
      const progress = freshProgress();
      progress.cursor = {
        kind: "step",
        stepId: hello.steps[0].id,
        beat: 3,
        fail: true,
      };
      progress.runs = {
        "s1.build": [
          {
            status: "failed",
            at: 2000,
            took: 1000,
            result: {
              act: "build",
              ok: false,
              seconds: 1,
              reason: "compiler",
              error: {
                code: "E0412",
                file: "src/lib.rs",
                line: 9,
                column: 32,
                message: "cannot find type `Hello`",
              },
              log: "",
            },
          },
          { status: "interrupted", at: 3000 },
        ],
      };
      expect(
        describeTutorial({
          definition: hello,
          progress,
          live: null,
          openFiles: [],
          currentFile: null,
        })
      ).toContain(
        "The last result: the build failed: E0412 at src/lib.rs:9, cannot find type `Hello`."
      );
    });

    it("before Start and after the finish", () => {
      const facts = (progress: ConversationProgress) =>
        describeTutorial({
          definition: hello,
          progress,
          live: null,
          openFiles: [],
          currentFile: null,
        });
      expect(facts(freshProgress())).toContain("They have not started yet");
      expect(facts(freshProgress())).toContain(BEGIN_INVITATION);
      const done = freshProgress();
      done.cursor = { kind: "finished" };
      expect(facts(done)).toContain("They finished every step.");
      const gone = freshProgress();
      gone.cursor = { kind: "step", stepId: "gone", beat: 0, fail: false };
      expect(facts(gone)).toContain("a step this tutorial no longer has");
      expect(facts(gone)).not.toContain("This is the last step.");
      for (const text of [facts(freshProgress()), facts(done), facts(gone)]) {
        expectEveryContext(text);
        expect(text).toContain("there is no yarn, npm or npx");
      }
    });

    it("says where the tutorial is now and the card it waits on, and that earlier turns are older (HOO-2823)", () => {
      // Only the fields `describeNow` reads
      const turn = (fields: Record<string, unknown>) =>
        fields as unknown as Turn;
      const inStep = freshProgress();
      inStep.startedAt = 1000;
      inStep.cursor = {
        kind: "step",
        stepId: hello.steps[0].id,
        beat: 0,
        fail: false,
      };
      const now = (progress: ConversationProgress, live: Turn | null) =>
        describeNow({ definition: hello, progress, live });
      const older =
        "Earlier turns describe the tutorial as it was then: answer from " +
        "this and the tutorial context, not from them.";

      expect(now(freshProgress(), turn({ kind: "intro" }))).toBe(
        `The tutorial now: they have not pressed Start yet: end your reply with "${BEGIN_INVITATION}" ${older}`
      );

      const ask = hello.steps[0].beats.find((b) => b.kind === "ask");
      const build = hello.steps[0].beats.find(
        (b): b is ActBeat => b.kind === "act"
      );
      if (ask?.kind !== "ask" || !build) {
        throw new Error("Hello Anchor's first step has no question or act");
      }
      const where = `The tutorial now: step 1 of 4, ${hello.steps[0].title}.`;
      expect(
        now(inStep, turn({ kind: "ask", open: true, beatId: ask.id, ask }))
      ).toBe(
        `${where} It waits on the open question: "${textOf(
          ask.question
        )}". ${older}`
      );
      const act = (state: string) =>
        now(inStep, turn({ kind: "act", beatId: build.id, act: build, state }));
      expect(act("live")).toBe(
        `${where} It waits for the "${build.button}" button on the "${build.title}" card. ${older}`
      );
      expect(act("running")).toContain("card. It is running now.");
      expect(act("interrupted")).toContain(
        "A reload interrupted its last run; pressing it runs it again."
      );
      expect(
        now(
          inStep,
          turn({ kind: "win", stepId: hello.steps[0].id, last: false })
        )
      ).toBe(
        `${where} The step is done: the next one opens from the "${nextStepLabel(
          hello.steps[1].title
        )}" button. ${older}`
      );
      expect(
        now(
          inStep,
          turn({ kind: "win", stepId: hello.steps[3].id, last: true })
        )
      ).toContain("The last step is done.");
      expect(now(inStep, turn({ kind: "result", open: true }))).toContain(
        "It waits on the failed result's card."
      );
      expect(now(inStep, null)).toBe(`${where} ${older}`);
      // A closed question or result waits on nothing
      expect(now(inStep, turn({ kind: "ask", open: false, ask }))).toBe(
        `${where} ${older}`
      );
      expect(now(inStep, turn({ kind: "result", open: false }))).toBe(
        `${where} ${older}`
      );
      // A save that outlived an edit of the tutorial
      expect(
        now(inStep, turn({ kind: "win", stepId: "gone", last: false }))
      ).toContain("The last step is done.");
      const gone = freshProgress();
      gone.cursor = { kind: "step", stepId: "gone", beat: 0, fail: false };
      expect(now(gone, null)).toBe(
        `The tutorial now: they are in a step this tutorial no longer has. ${older}`
      );
      const done = freshProgress();
      done.cursor = { kind: "finished" };
      expect(now(done, null)).toBe(
        `The tutorial now: they finished every step. ${older}`
      );
    });
  });
}
