import { solOn, UNKNOWN_NETWORK } from "@/constants";
import { bindToolFor } from "@/entities/agent-tools";
import { formatSol } from "@/features/deploy";
import type { ToolDefinition, ToolInput } from "@/shared/lib/ai";
import { createLogger } from "@/shared/lib/logger";

import { type PlaygroundBridge, realBridge } from "../bridge/playground-bridge";
import { PgPatchUndo } from "../patch-undo";
import { type AssistantMode, PgAssistant, wroteOutcome } from "../store";
import { createMcpTools } from "./mcp-tools";
import { createSkillTools } from "./skill-tools";

const log = createLogger("assistant:tools");

/** The project's name, as the approval cards name the program */
const programName = (bridge: PlaygroundBridge) =>
  bridge.getProjectContext().workspaceName ?? "the program";

/** Read a required string argument the model supplied */
const str = (input: ToolInput, key: string) => {
  const value = input[key];
  return typeof value === "string" ? value : "";
};

/**
 * What `read_file` answers for a file outside the conversation's context.
 *
 * @param path the relative path the model asked for
 * @returns the refusal, with no content of the file
 */
export const notInContext = (path: string) =>
  `${path} is not in this conversation's context, so you cannot read it. ` +
  `Ask the user to add it with + in the composer (Add a file), then read it.`;

/**
 * What the assistant can do to the project.
 *
 * Reads run unattended. Everything that changes state — writing a file,
 * building, deploying — calls `PgAssistant.requestApproval` and does not
 * return until the user clicks, which holds the agent loop open. That is
 * "propose automatically, apply explicitly" enforced inside the loop rather
 * than around it, and it works the same whichever provider is driving.
 *
 * Skill and MCP tools are appended here rather than wired per provider, so
 * every backend gets ecosystem grounding without touching its adapter.
 *
 * What each tool is called, what the model reads about it and its arguments
 * come from `entities/agent-tools`, which server code can import through its
 * `server.mjs`; this file only says what each one does in the tab.
 *
 * A mode's own tools (below) run as the mode defines them, without
 * `requestApproval`: the mode answers for what they change.
 *
 * With a mode set (`PgAssistant.setMode`), a tool the mode does not allow
 * stays offered but only answers with a refusal, so the model is told why
 * rather than calling a tool that is not there; the mode's own tools join.
 *
 * @param bridge the playground to act on
 * @param mode the surface narrowing the assistant, if any
 * @returns vendor-neutral tool definitions
 */
export const createTools = (
  // eslint-disable-next-line layers/curry-order -- tutorial flow v2 predates this rule; cleanup tracked from SF#94
  bridge: PlaygroundBridge = realBridge,
  // eslint-disable-next-line layers/curry-order -- tutorial flow v2 predates this rule; cleanup tracked from SF#94
  mode: AssistantMode | null = PgAssistant.mode
): ToolDefinition[] => {
  const own = projectTools(bridge);
  if (!mode) return own;
  return [
    ...own.map((tool) => (mode.allows(tool.name) ? tool : refused(tool, mode))),
    ...mode.tools,
  ];
};

/** A tool the mode does not allow: offered as it was, refusing to run */
const refused = (
  tool: ToolDefinition,
  mode: AssistantMode
): ToolDefinition => ({
  name: tool.name,
  description: `Not available in this ${mode.name}. ${tool.description}`,
  schema: tool.schema,
  run: () => {
    log.info(`refused ${tool.name} in the ${mode.name} mode`);
    return `${tool.name} is not available in this ${mode.name}. ${mode.refusal}`;
  },
});

const projectTools = (bridge: PlaygroundBridge): ToolDefinition[] => [
  ...createSkillTools(),
  ...createMcpTools(),

  bindToolFor("read_file")((input) => {
    const asked = str(input, "path");
    const path = bridge.toProjectPath(asked);
    // The context is the user's decision (HOO-2424): a file they did not open
    // or add stays on this side, whatever the model asks
    if (path === undefined || !bridge.listContextFiles().includes(path)) {
      PgAssistant.addToolCall(`was refused ${path ?? asked}: not in context`);
      return notInContext(path ?? asked);
    }
    PgAssistant.addToolCall(`read ${path}`);
    const content = bridge.readFile(path);
    return content === null ? `There is no file at ${path}.` : content;
  }),

  bindToolFor("get_build_error")(() => {
    PgAssistant.addToolCall("read the build output");
    const { buildError } = bridge.getProjectContext();
    return (
      buildError ??
      "The last build did not fail, or nothing has been built yet."
    );
  }),

  bindToolFor("write_file")(async (input) => {
    const asked = str(input, "path");
    const path = bridge.toProjectPath(asked);
    if (path === undefined) {
      return `Could not write ${asked}: it is outside the project.`;
    }
    const content = str(input, "content");
    const before = bridge.readFile(path);

    // Rewriting a file with what it already holds is not a change. Showing it
    // as one lets a lesson step look confirmed by an approval card that did
    // nothing — the assertion the toolchain is supposed to be grading.
    // Only for a file in the context: for any other, "nothing to change"
    // would confirm the model's guess at a file it may not read, so that
    // write goes to the user's approval like any other
    if (before === content && bridge.listContextFiles().includes(path)) {
      return (
        `${path} already contains exactly that content, so there is nothing ` +
        `to change. Do not propose it again — tell the user what still has ` +
        `to happen for this to be proven.`
      );
    }

    // The id comes back with the answer: another tool's card may have been
    // added while this one waited, so "the latest card" is not this one
    const { id: approvalId, allowed } = await PgAssistant.requestApproval({
      type: "patch",
      path,
      before,
      after: content,
    });

    if (!allowed) {
      return (
        "The user rejected this change. Do not try to apply it again — ask " +
        "what they would prefer instead."
      );
    }

    // Only the write itself: once it has happened, nothing after it may say
    // it did not
    try {
      await bridge.applyPatch({ path, content });
    } catch (e) {
      // TODO(HOO-2603): log an error that is not an `ExplorerLimitError`
      // with `report: true`; a storage failure reaches no logger here
      const message = e instanceof Error ? e.message : String(e);
      PgAssistant.setApprovalFailure(approvalId, `not written: ${message}`);
      return `Could not write ${path}: ${message}`;
    }
    PgAssistant.setApprovalOutcome(approvalId, wroteOutcome(path));
    PgPatchUndo.wrote(approvalId);
    return `Wrote ${path}.`;
  }),

  bindToolFor("build")(async () => {
    const { id: approvalId, allowed } = await PgAssistant.requestApproval({
      type: "command",
      name: "build",
      effect:
        "Sends src/ to the build server and replaces the compiled program.",
      question: `Build ${programName(bridge)}?`,
    });
    if (!allowed) return "The user declined to build.";

    try {
      await bridge.build();
      const { buildError } = bridge.getProjectContext();
      if (buildError) {
        PgAssistant.setApprovalFailure(approvalId, "build failed");
        return `The build failed:\n\n${buildError}`;
      }
      PgAssistant.setApprovalOutcome(approvalId, "build succeeded");
      return "The build succeeded.";
    } catch (e) {
      // TODO(HOO-2603): log the error with `report: true`; a build that
      // could not run reaches no logger here
      const message = e instanceof Error ? e.message : String(e);
      PgAssistant.setApprovalFailure(
        approvalId,
        `build could not run: ${message}`
      );
      return `The build could not run: ${message}`;
    }
  }),

  bindToolFor("deploy")(async () => {
    const { cluster } = bridge.getProjectContext();
    const quote = await bridge.quoteDeploy();
    const cost =
      quote.cost === null
        ? ""
        : ` It costs about ${formatSol(quote.cost)} ${solOn(
            quote.network
          )} from ${
            quote.playground ? "your Playground wallet" : "your wallet"
          }.`;
    const { id: approvalId, allowed } = await PgAssistant.requestApproval({
      type: "command",
      name: "deploy",
      effect: `Sends a transaction to ${cluster} and spends SOL from the connected wallet.`,
      question: `Deploy ${programName(bridge)} to ${
        quote.network ?? UNKNOWN_NETWORK
      }?${cost}`,
    });
    if (!allowed) return "The user declined to deploy.";
    // The card named the network it was asked on; a switch while it waited
    // would spend SOL somewhere the user never approved
    if (bridge.getProjectContext().cluster !== cluster) {
      PgAssistant.setApprovalFailure(
        approvalId,
        "not deployed: network changed"
      );
      return (
        "The network changed while the approval waited, so nothing was " +
        "deployed. Ask the user whether to deploy to the network now selected."
      );
    }

    try {
      const deployed = await bridge.deploy();
      PgAssistant.setApprovalOutcome(approvalId, "deployed");
      if (!deployed) {
        return "Deployed. The program id and transaction are in the terminal.";
      }
      return (
        `Deployed program ${deployed.programId}. View it on the block ` +
        `explorer: ${deployed.explorerUrl} — give the user this link as ` +
        `a markdown link.`
      );
    } catch (e) {
      // TODO(HOO-2603): log the error with `report: true`; a failed deploy
      // reaches no logger here
      const message = e instanceof Error ? e.message : String(e);
      PgAssistant.setApprovalFailure(approvalId, `deploy failed: ${message}`);
      return `The deployment failed: ${message}`;
    }
  }),
];
