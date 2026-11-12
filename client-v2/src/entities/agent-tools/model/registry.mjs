// The assistant's built-in tools, declared once: browser code imports them through
// `index.ts`, server code under `api/` through `server.mjs`. Plain ESM with no imports, so Node loads it without a build
// step (see features/auth/config.mjs for the same arrangement).
//
// Data only. The panel binds a runner to each tool name, and a test fails when
// the panel's tools differ from these declarations. Every backend gets the
// panel's tools (the default one through `api/agent.mjs`, which forwards
// them), so the declarations here are what each of them offers.

/** @type {{ type: "object", properties: {}, additionalProperties: false }} */
const NO_ARGUMENTS = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

/**
 * @typedef {object} ToolDeclaration
 * @property {string} name
 * @property {string} description what the model reads when choosing a tool
 * @property {{
 *   type: "object",
 *   properties: Record<string, unknown>,
 *   required?: string[],
 *   additionalProperties: false,
 * }} schema JSON Schema for the tool's arguments
 * @property {boolean} approval whether the tool changes state. The runner
 *   enforces it by asking the user; `tools-registry.test.ts` checks that a
 *   marked tool asks and an unmarked one neither asks nor changes anything
 */

/**
 * The built-in tools, in the order the model sees them. MCP tools are
 * discovered at runtime and sit between the skill tools and the project
 * tools; they are not declared here.
 *
 * @type {readonly ToolDeclaration[]}
 */
export const BUILTIN_TOOLS = [
  {
    name: "list_skills",
    description:
      "List the enabled skills with what each covers. Returns the same " +
      "catalogue the system prompt already lists, so there is no need to " +
      "call it before load_skill.",
    schema: NO_ARGUMENTS,
    approval: false,
  },
  {
    name: "load_skill",
    description:
      "Read a skill's main document. The document names its own reference " +
      "files; read those with read_skill_reference rather than guessing at " +
      "their contents. Returns an error string if the id is unknown, the " +
      "skill is switched off, or the fetch fails.",
    schema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Skill id from list_skills, e.g. playground-env",
        },
      },
      required: ["id"],
      additionalProperties: false,
    },
    approval: false,
  },
  {
    name: "read_skill_reference",
    description:
      "Read one reference file belonging to a skill, using a path the " +
      "skill's own document gave you. Paths are relative to the skill " +
      "folder, e.g. references/common-errors.md; a path outside that " +
      "folder is rejected. Bundled skills such as playground-env have no " +
      "reference files. Very large files come back truncated with a marker. " +
      "Returns an error string if the skill is switched off or the read fails.",
    schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Skill id, e.g. solana-dev" },
        path: {
          type: "string",
          description:
            "Path relative to the skill folder, e.g. references/security.md",
        },
      },
      required: ["id", "path"],
      additionalProperties: false,
    },
    approval: false,
  },
  {
    name: "read_file",
    description:
      "Read one file in the conversation's context: the user's open tabs " +
      "and the files they added. Any other file is refused; ask the user to " +
      "add it with + in the composer. Always read a file before proposing a " +
      "change to it, so the change matches what is actually there.",
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
    approval: false,
  },
  {
    name: "get_build_error",
    description:
      "Get the compiler output from the most recent build. Returns the " +
      "compiler's own text, including file paths and error codes. Use this " +
      "rather than guessing what an error says.",
    schema: NO_ARGUMENTS,
    approval: false,
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
    approval: true,
  },
  {
    name: "build",
    description:
      "Compile the program. Requires the user's approval. After it finishes, " +
      "call get_build_error to see what the compiler said.",
    schema: NO_ARGUMENTS,
    approval: true,
  },
  {
    name: "deploy",
    description:
      "Deploy the compiled program to the configured cluster. Requires the " +
      "user's approval. Costs SOL from the connected wallet; when it holds " +
      "too little, the terminal asks the user whether to request an airdrop.",
    schema: NO_ARGUMENTS,
    approval: true,
  },
];
