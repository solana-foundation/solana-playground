import { createMcpTools } from "./mcp-tools";
import { createSkillTools } from "./skill-tools";
import { PgAssistant } from "../store";
import { realBridge, type PlaygroundBridge } from "../bridge/playground-bridge";
import type { ToolDefinition, ToolInput } from "./types";

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
 * @param bridge the playground to act on
 * @returns vendor-neutral tool definitions
 */
export const createTools = (
  bridge: PlaygroundBridge = realBridge
): ToolDefinition[] => [
  ...createSkillTools(),
  ...createMcpTools(),

  {
    name: "list_files",
    description:
      "List every file in the user's project, as paths relative to the " +
      "project root. Use this to find out what exists before reading.",
    schema: { type: "object", properties: {}, additionalProperties: false },
    run: () => {
      PgAssistant.addToolCall("listed the project");
      const paths = bridge.listFiles();
      return paths.length ? paths.join("\n") : "The project has no files.";
    },
  },

  {
    name: "read_file",
    description:
      "Read one file from the user's project. Always read a file before " +
      "proposing a change to it, so the change matches what is actually there.",
    schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path relative to the project root, e.g. src/lib.rs",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    run: (input) => {
      const path = str(input, "path");
      PgAssistant.addToolCall(`read ${path}`);
      const content = bridge.readFile(path);
      return content === null ? `There is no file at ${path}.` : content;
    },
  },

  {
    name: "get_build_error",
    description:
      "Get the compiler output from the most recent build. Returns the " +
      "compiler's own text, including file paths and error codes. Use this " +
      "rather than guessing what an error says.",
    schema: { type: "object", properties: {}, additionalProperties: false },
    run: () => {
      PgAssistant.addToolCall("read the build output");
      const { buildError } = bridge.getProjectContext();
      return (
        buildError ??
        "The last build did not fail, or nothing has been built yet."
      );
    },
  },

  {
    name: "write_file",
    description:
      "Propose new content for a file. This does NOT write anything on its " +
      "own — the user is shown a diff and decides. Send the file's complete " +
      "new content, not a fragment. Prefer the smallest change that fixes " +
      "the problem.",
    schema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path relative to the project root, e.g. src/lib.rs",
        },
        content: {
          type: "string",
          description: "The complete new content of the file",
        },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
    run: async (input) => {
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
    },
  },

  {
    name: "build",
    description:
      "Compile the program. Requires the user's approval. After it finishes, " +
      "call get_build_error to see what the compiler said.",
    schema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => {
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
    },
  },

  {
    name: "deploy",
    description:
      "Deploy the compiled program to the configured cluster. Requires the " +
      "user's approval. Costs SOL and needs a funded wallet.",
    schema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => {
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
    },
  },
];
