/* eslint-disable unicorn/no-null -- tutorial flow v2 predates this rule; cleanup tracked from SF#94 */
import { PgConversation } from "@/features/tutorial-conversation";
import type { ToolInput } from "@/shared/lib/ai";
import { uuid } from "@/shared/lib/ids";
import { createLogger } from "@/shared/lib/logger";
import { PgExplorer } from "@/utils/explorer";
import { READING_TOOLS } from "@/views/sidebar/assistant/model/reading-tools";
import type { AssistantMode } from "@/views/sidebar/assistant/store";
import { PgAssistant } from "@/views/sidebar/assistant/store";

import { BEGIN_INVITATION, describeTutorial, TOOLS } from "./context";

const log = createLogger("tutorial-conversation:mode");

/** A string argument the model supplied, or "" */
const str = (input: ToolInput, key: string) => {
  const value = input[key];
  return typeof value === "string" ? value : "";
};

const NO_PARAMS = {
  type: "object" as const,
  properties: {},
  additionalProperties: false as const,
};

/** The open question's beat id, or null */
const openQuestion = (): string | null => {
  const live = PgConversation.view()?.live;
  return live?.kind === "ask" && live.open ? live.beatId : null;
};

/**
 * The tutorial's mode for the live assistant (`PgAssistant.setMode`): the
 * lesson's context (`describeTutorial`), the read-only tools, and four
 * tools of its own: the menu; the question's Hint, and its Skip, which
 * resolves it and has the lesson write its block, as the buttons do; and a
 * one-line change the learner applies or keeps. The assistant itself writes
 * nothing.
 *
 * @param openMenu opens the frame's navigation, which another widget owns
 */
export const tutorialMode = ({
  openMenu,
}: {
  openMenu: () => void;
}): AssistantMode => ({
  name: "tutorial",
  // Reading only: writing, building and deploying stay the lesson's (spec
  // "One composer; free questions go to the live assistant")
  allows: (name) => READING_TOOLS.has(name),
  refusal:
    "In a tutorial you cannot change files, build, deploy or send " +
    "transactions: the lesson does those. Tell the learner which button or " +
    `step does it, or offer a change with ${TOOLS.propose}.`,
  context: () => {
    const { context, engine } = PgConversation.state;
    if (!context) return "The learner is not in a tutorial right now.";
    return describeTutorial({
      definition: context.definition,
      progress: engine.progress,
      live: PgConversation.view()?.live ?? null,
      openFiles: PgExplorer.tabs.map((tab) => PgExplorer.getRelativePath(tab)),
      currentFile: PgExplorer.currentFilePath
        ? PgExplorer.getRelativePath(PgExplorer.currentFilePath)
        : null,
    });
  },
  tools: [
    {
      name: TOOLS.openMenu,
      description:
        "Open the tutorial's navigation menu, with its steps and the other " +
        "tutorials. Use it when the learner asks for the menu.",
      schema: NO_PARAMS,
      run: () => {
        PgAssistant.addToolCall("opened the menu");
        openMenu();
        return PgConversation.view()?.live?.kind === "intro"
          ? `The menu is open. They have not started: end your reply with "${BEGIN_INVITATION}"`
          : "The menu is open.";
      },
    },
    {
      name: TOOLS.hint,
      description:
        "Post the open question's own hint under it, as its Hint button " +
        "does. Use it when the learner is stuck on the question.",
      schema: NO_PARAMS,
      run: () => {
        const beatId = openQuestion();
        if (!beatId) return "No question is open, so there is no hint to post.";
        const live = PgConversation.view()?.live;
        if (live?.kind === "ask" && live.hinted) {
          return "The hint is already shown under the question. Help in your own words instead.";
        }
        PgAssistant.addToolCall("posted the hint");
        PgConversation.hint(beatId, { byAssistant: true });
        return "The hint is posted under the question. Do not repeat it.";
      },
    },
    {
      name: TOOLS.skip,
      description:
        "Skip the open question, as its Skip button does: the lesson writes " +
        "its answer's code. Use it only when the learner asks you to do it " +
        "for them.",
      schema: NO_PARAMS,
      run: () => {
        const beatId = openQuestion();
        if (!beatId) return "No question is open, so there is nothing to skip.";
        // Read before the skip: once it resolves, the question is not live
        const live = PgConversation.view()?.live;
        const writes = live?.kind === "ask" ? live.ask.writes : undefined;
        PgAssistant.addToolCall("skipped the question");
        PgConversation.skip(beatId);
        if (!writes) return "Skipped. This question writes no code.";
        return (
          "Skipped: the lesson is writing the answer's code into " +
          `${writes.file}, and its card says if the write fails.`
        );
      },
    },
    {
      name: TOOLS.propose,
      description:
        "Propose changing one line of a file. The learner sees the line's " +
        "diff with Apply and Keep it; nothing changes until they press " +
        "Apply. Read the file first, and send the whole new line.",
      schema: {
        type: "object",
        properties: {
          file: {
            type: "string",
            description:
              "Path relative to the project root, e.g. programs/hello/src/lib.rs",
          },
          line: { type: "number", description: "1-based line number" },
          after: { type: "string", description: "The whole new line" },
        },
        required: ["file", "line", "after"],
        additionalProperties: false,
      },
      run: (input) => {
        const file = str(input, "file");
        const line = input.line;
        if (typeof line !== "number" || !Number.isInteger(line) || line < 1) {
          return "The line must be a whole number from 1.";
        }
        const read = readFile(file);
        if (read.kind === "missing") return `There is no file at ${file}.`;
        if (read.kind === "failed") {
          return `Could not read ${file}: the project's files could not be read.`;
        }
        const before = read.content.split("\n")[line - 1];
        if (before === undefined) return `${file} has no line ${line}.`;
        const after = input.after;
        if (typeof after !== "string")
          return "Send the whole new line as `after`.";
        if (/[\r\n]/.test(after)) {
          return "Propose one line at a time: `after` must not break the line.";
        }
        if (before === after) return "That line already reads so.";
        PgAssistant.addToolCall(`proposed a change to ${file}`);
        PgConversation.propose({
          id: uuid(),
          // The workspace's own form of the path, as the lesson's files use
          file: PgExplorer.getRelativePath(PgExplorer.convertToFullPath(file)),
          line,
          before,
          after,
        });
        return (
          "The change is posted as a card; the learner decides. Do not " +
          "propose it again."
        );
      },
    },
  ],
});

/** A file the assistant named, as the explorer holds it */
type Read =
  | { kind: "ok"; content: string }
  | { kind: "missing" }
  | { kind: "failed" };

const readFile = (file: string): Read => {
  try {
    const content = PgExplorer.getFileContent(
      PgExplorer.convertToFullPath(file)
    );
    return content === undefined
      ? { kind: "missing" }
      : { kind: "ok", content };
  } catch (e) {
    // A missing file reads as undefined; a throw is the explorer failing
    log.error(e, { report: true, context: { file, what: "assistant read" } });
    return { kind: "failed" };
  }
};
