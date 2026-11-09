/* eslint-disable unicorn/no-null -- tutorial flow v2 predates this rule; cleanup tracked from SF#94 */
import type { Doc, TutorialDefinition } from "@/entities/tutorial";
import type {
  ConversationProgress,
  RunRecord,
  RunResult,
  Turn,
} from "@/features/tutorial-conversation";
import { createLogger } from "@/shared/lib/logger";
import { sectionsOf } from "@/shared/lib/markdown-sections";

const log = createLogger("tutorial-conversation:context");

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
  /**
   * The tutorial's `docs/` Markdown by file name, for the pages' sections;
   * a page missing here is listed by title and address alone
   */
  docPages: Readonly<Record<string, string>> | undefined;
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
  const last = lastRun(progress);
  if (last) lines.push(`The last result: ${describeRun(last)}.`);
  if (facts.openFiles.length) {
    lines.push(
      `Open files: ${facts.openFiles.join(", ")}` +
        (facts.currentFile ? `; in front: ${facts.currentFile}.` : ".")
    );
  }
  if (definition.docs?.length) {
    if (facts.docPages === undefined) {
      // Once per description, not per page: the assistant then links every
      // page at its top, which reads like pages with no sections
      log.warn("the facts carry no doc pages for a tutorial that lists some", {
        context: {
          tutorial: definition.name,
          files: definition.docs.map((d) => d.file),
        },
      });
    }
    lines.push(
      "This tutorial's doc pages, which open beside the code: " +
        definition.docs.map(describeDoc(facts.docPages)).join("; ") +
        ". When one of them covers what you explain, link it as a Markdown " +
        "link with its address exactly as listed: the section that covers " +
        "it when one does, the page otherwise. When you also name the page " +
        "a section is in, link the page too. Link another site only " +
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
 * A doc page for the context: its title and address, then its sections
 * with their `page#id` addresses (spec "The assistant's context lists each
 * doc page's sections"); the title and address alone for a page with no
 * section or no Markdown
 */
const describeDoc =
  (docPages: TutorialFacts["docPages"]) =>
  (doc: Doc): string => {
    const markdown = docPages?.[doc.file];
    if (docPages !== undefined && markdown === undefined) {
      // The check rejects a listed page with no Markdown when it is given
      // the pages, as the app's loader is, so pages that lack one did not
      // come through it; `describeTutorial` warns for pages absent as a whole
      log.warn("a listed doc page has no Markdown in the facts", {
        context: { file: doc.file },
      });
    }
    const sections = markdown === undefined ? [] : sectionsOf(markdown);
    if (sections.length === 0) return `${doc.title} (${doc.url})`;
    const listed = sections
      .map((s) => `${s.title} (${doc.url}#${s.id})`)
      .join(", ");
    return `${doc.title} (${doc.url}), sections: ${listed}`;
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
        docPages: undefined,
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
        docPages: { "log.md": "# The program log\n\nJust the title." },
        progress: freshProgress(),
        live,
        openFiles: [],
        currentFile: null,
      });
      expect(text).toContain("Do not give its answer away");
      expect(text).toContain(`${TOOLS.hint} posts the lesson's own hint`);
      expect(text).toContain(
        "This tutorial's doc pages, which open beside the code: The program log (https://solana.com/docs/programs/debugging). When one of them covers what you explain, link it as a Markdown link with its address exactly as listed: the section that covers it when one does, the page otherwise. When you also name the page a section is in, link the page too. Link another site only for what none of them covers, and one page at most per answer."
      );
    });

    it("lists each doc page's sections with their addresses, pages with none as before", () => {
      const url = "https://www.anchor-lang.com/docs/basics/program-structure";
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
          { title: "Program Structure", url, file: "program-structure.md" },
          {
            title: "Programs",
            url: "https://solana.com/docs/core/programs",
            file: "programs.md",
          },
          {
            title: "Transactions",
            url: "https://solana.com/docs/core/transactions",
            file: "transactions.md",
          },
        ],
      };
      const text = describeTutorial({
        definition: withDocs,
        docPages: {
          "program-structure.md":
            "# Program Structure\n\n## #[account] attribute\n\n### Account Discriminator\n",
          "programs.md": "# Programs\n\nNo sections.",
        },
        progress: freshProgress(),
        live: null,
        openFiles: [],
        currentFile: null,
      });
      expect(text).toContain(
        `Program Structure (${url}), sections: #[account] attribute (${url}#account-attribute), Account Discriminator (${url}#account-discriminator); ` +
          "Programs (https://solana.com/docs/core/programs); " +
          "Transactions (https://solana.com/docs/core/transactions). When one"
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
          docPages: undefined,
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
          docPages: undefined,
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
