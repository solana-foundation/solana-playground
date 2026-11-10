/* eslint-disable unicorn/no-null -- tutorial flow v2 predates this rule; cleanup tracked from SF#94 */
import type { ActBeat, TutorialDefinition } from "@/entities/tutorial";
import type {
  ConversationProgress,
  RunRecord,
  RunResult,
  Turn,
} from "@/features/tutorial-conversation";

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
 * step asks, the last result, the files and the docs it may link, and what
 * it may and may not do here. Copy from the definition, facts from the save.
 */
export const describeTutorial = (facts: TutorialFacts): string => {
  const { definition, progress, live } = facts;
  const lines = [
    `The learner is in the tutorial "${definition.name}" in Solana Playground, ` +
      `${definition.steps.length} steps, on devnet.`,
    whereOf(definition, progress),
  ];
  if (live?.kind === "ask" && live.open) {
    lines.push(
      `A question is open: "${textOf(live.ask.question)}". Do not give its ` +
        `answer away; ${TOOLS.hint} posts the lesson's own hint, and ` +
        `${TOOLS.skip} skips it, as its buttons do.`
    );
  }
  if (live?.kind === "act") lines.push(whereActIs(live));
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
  return (
    `Step ${i + 1} of ${definition.steps.length}: ${step.title}. ` +
    `Objective: ${step.objective}. The step's file: ${step.file}.${passed}`
  );
};

/**
 * What else, if anything, runs the live act outside its card. Asked "how do
 * I build?", the assistant sent learners to a Build action on the stage bar,
 * which has none, and a tutorial's frame draws no Write/Build/Deploy/Interact
 * tabs either (HOO-2755). A build or a deploy the lesson reads runs from the
 * card alone: the terminal's `build` compiles but passes no step. A call has
 * the Call panel and a run has the client file too (`PassedVia`).
 */
const BESIDES_THE_CARD: Record<ActBeat["act"], string> = {
  build:
    "It is the only build the lesson reads: the work area has no Build action or tab in a tutorial, and a build typed in the terminal passes no step.",
  deploy:
    "It is the only deploy the lesson reads: the work area has no Deploy action or tab in a tutorial, and a deploy typed in the terminal passes no step.",
  buildDeploy:
    "It is the only build and deploy the lesson reads: the work area has no Build or Deploy action or tab in a tutorial, and the terminal's commands pass no step.",
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
const whereActIs = (live: Extract<Turn, { kind: "act" }>): string => {
  let state = "";
  if (live.state === "running") state = " It is running now.";
  if (live.state === "interrupted") {
    state = " A reload interrupted its last run; pressing it runs it again.";
  }
  return (
    `The step waits for the "${live.act.button}" button on the ` +
    `"${live.act.title}" card in the tutorial feed, in this chat. ` +
    `${BESIDES_THE_CARD[live.act.act]} Point the learner to that card.${state}`
  );
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
      expect(text).not.toContain(BEGIN_INVITATION);
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
        "the work area has no Build action or tab in a tutorial"
      );
      expect(text).not.toContain("It is running now.");
      expect(text).not.toContain("A reload interrupted");
      expect(describeTutorial(facts(card(build, "running")))).toContain(
        "It is running now."
      );
      expect(describeTutorial(facts(card(build, "interrupted")))).toContain(
        "A reload interrupted its last run; pressing it runs it again."
      );
      const called = describeTutorial(facts(card(call, "live")));
      expect(called).toContain("The Call panel in the work area's head");
      expect(called).not.toContain("only way");
    });

    it("guards an open question's answer and lists the tutorial's docs", () => {
      const ask = hello.steps[0].beats.find(
        (b): b is import("@/entities/tutorial").Ask => b.kind === "ask"
      );
      if (!ask) throw new Error("Hello Anchor has no question in step 1");
      const live: Turn = {
        id: ask.id,
        kind: "ask",
        step: hello.steps[0].id,
        at: 1,
        whole: false,
        beatId: ask.id,
        ask,
        open: true,
        wrong: [],
        hinted: false,
        writeFailed: false,
        outcome: null,
        attempts: 0,
      };
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
      expect(text).toContain("Do not give its answer away");
      expect(text).toContain(`${TOOLS.hint} posts the lesson's own hint`);
      expect(text).toContain(
        "This tutorial's doc pages, which open beside the code: The program log (https://solana.com/docs/programs/debugging). When one of them covers what you explain, link it as a Markdown link with its address exactly as listed. Link another site only for what none of them covers, and one page at most per answer."
      );
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
    });
  });
}
