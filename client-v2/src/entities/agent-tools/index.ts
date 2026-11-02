// Public API of the slice for the browser. `server.mjs` is the same registry
// for server code.
import { BUILTIN_TOOLS } from "./model/registry.mjs";
import type { ToolDefinition } from "@/shared/lib/ai";

export {
  BUILTIN_TOOLS,
  DEFAULT_MCP_SERVERS,
  SKILL_CATALOGUE,
} from "./model/registry.mjs";
export type {
  McpUpstream,
  SkillDeclaration,
  ToolDeclaration,
} from "./model/registry.mjs";

/**
 * A declared tool with the browser's runner attached. Name, description and
 * schema come from the registry, so the panel cannot describe a tool
 * differently from its declaration, which `server.mjs` exposes to server code.
 *
 * @param name a name in {@link BUILTIN_TOOLS}
 * @param run what the tool does in this tab
 * @throws when the name is not declared, so a runner cannot exist without a
 *   declaration
 */
export const bindTool = (
  name: string,
  run: ToolDefinition["run"]
): ToolDefinition => {
  const declared = BUILTIN_TOOLS.find((tool) => tool.name === name);
  if (!declared) {
    throw new Error(
      `"${name}" is not declared in entities/agent-tools; declare it there ` +
        "so the browser and server code agree on it."
    );
  }
  const { description, schema } = declared;
  return { name, description, schema, run };
};

if (import.meta.vitest) {
  const { describe, it, expect, beforeAll } = import.meta.vitest;

  describe("entities/agent-tools/index", () => {
    let browser: typeof import("./index");
    let server: typeof import("./server.mjs");
    beforeAll(async () => {
      browser = await import("./index");
      server = await import("./server.mjs");
    });

    it("gives server code the same registry as the browser", () => {
      expect(server.BUILTIN_TOOLS).toBe(browser.BUILTIN_TOOLS);
      expect(server.SKILL_CATALOGUE).toBe(browser.SKILL_CATALOGUE);
      expect(server.DEFAULT_MCP_SERVERS).toBe(browser.DEFAULT_MCP_SERVERS);
    });

    it("bindTool takes the description and schema from the registry", () => {
      const run = () => "ran";
      const tool = bindTool("read_file", run);
      const declared = BUILTIN_TOOLS.find((t) => t.name === "read_file")!;

      expect(tool.description).toBe(declared.description);
      expect(tool.schema).toBe(declared.schema);
      expect(tool.run).toBe(run);
    });

    it("bindTool refuses a name the registry does not declare", () => {
      expect(() => bindTool("format_disk", () => "")).toThrow(
        /"format_disk" is not declared/
      );
    });
  });
}
