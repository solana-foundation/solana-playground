import { createMcpTools } from "./mcp-tools";
import { createSkillTools } from "./skill-tools";
import { PgAssistant } from "../store";
import { realBridge, type PlaygroundBridge } from "../bridge/playground-bridge";
import { bindTool } from "@/entities/agent-tools";
import type { ToolDefinition, ToolInput } from "@/shared/lib/ai";

/** Read a required string argument the model supplied */
const str = (input: ToolInput, key: string) => {
  const value = input[key];
  return typeof value === "string" ? value : "";
};

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
 * @param bridge the playground to act on
 * @returns vendor-neutral tool definitions
 */
export const createTools = (
  bridge: PlaygroundBridge = realBridge
): ToolDefinition[] => [
  ...createSkillTools(),
  ...createMcpTools(),

  bindTool("list_files", () => {
    PgAssistant.addToolCall("listed the project");
    const paths = bridge.listFiles();
    return paths.length ? paths.join("\n") : "The project has no files.";
  }),

  bindTool("read_file", (input) => {
    const path = str(input, "path");
    PgAssistant.addToolCall(`read ${path}`);
    const content = bridge.readFile(path);
    return content === null ? `There is no file at ${path}.` : content;
  }),

  bindTool("get_build_error", () => {
    PgAssistant.addToolCall("read the build output");
    const { buildError } = bridge.getProjectContext();
    return (
      buildError ??
      "The last build did not fail, or nothing has been built yet."
    );
  }),

  bindTool("write_file", async (input) => {
    const path = str(input, "path");
    const content = str(input, "content");
    const before = bridge.readFile(path);

    // Rewriting a file with what it already holds is not a change. Showing it
    // as one lets a lesson step look confirmed by an approval card that did
    // nothing — the assertion the toolchain is supposed to be grading.
    if (before === content) {
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

    try {
      await bridge.applyPatch({ path, content });
      PgAssistant.setApprovalOutcome(approvalId, `wrote ${path}`);
      return `Wrote ${path}.`;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      PgAssistant.setApprovalOutcome(approvalId, "write failed");
      return `Could not write ${path}: ${message}`;
    }
  }),

  bindTool("build", async () => {
    const { id: approvalId, allowed } = await PgAssistant.requestApproval({
      type: "command",
      name: "build",
      effect:
        "Sends src/ to the build server and replaces the compiled program.",
    });
    if (!allowed) return "The user declined to build.";

    try {
      await bridge.build();
      const { buildError } = bridge.getProjectContext();
      PgAssistant.setApprovalOutcome(
        approvalId,
        buildError ? "build failed" : "build succeeded"
      );
      return buildError
        ? `The build failed:\n\n${buildError}`
        : "The build succeeded.";
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      PgAssistant.setApprovalOutcome(approvalId, "build errored");
      return `The build could not run: ${message}`;
    }
  }),

  bindTool("deploy", async () => {
    const { cluster } = bridge.getProjectContext();
    const { id: approvalId, allowed } = await PgAssistant.requestApproval({
      type: "command",
      name: "deploy",
      effect: `Sends a transaction to ${cluster} and spends SOL from the connected wallet.`,
    });
    if (!allowed) return "The user declined to deploy.";

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
      const message = e instanceof Error ? e.message : String(e);
      PgAssistant.setApprovalOutcome(approvalId, "deploy failed");
      return `The deployment failed: ${message}`;
    }
  }),
];
