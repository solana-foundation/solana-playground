// What the assistant offers, declared once: browser code imports it through
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
      "skill is disabled or the fetch fails.",
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
      "Returns an error string if the skill is disabled or the read fails.",
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
    name: "list_files",
    description:
      "List every file in the user's project, as paths relative to the " +
      "project root. Use this to find out what exists before reading.",
    schema: NO_ARGUMENTS,
    approval: false,
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
      "user's approval. Costs SOL and needs a funded wallet.",
    schema: NO_ARGUMENTS,
    approval: true,
  },
];

/**
 * @typedef {object} SkillDeclaration
 * @property {string} id
 * @property {string} name
 * @property {string} description the one line the model reads when deciding
 *   whether to load the skill
 * @property {{ type: "bundled" } | { type: "remote", baseUrl: string, entry: string }} source
 *   where the files come from. A bundled skill's text is a browser asset,
 *   bound to its id by the panel, since Node cannot import markdown.
 */

/**
 * The skills the assistant offers, in the order the picker and the prompt
 * list them. All of them are on unless the user turns one off.
 *
 * @type {readonly SkillDeclaration[]}
 */
export const SKILL_CATALOGUE = [
  {
    id: "playground-env",
    name: "Playground build environment",
    description:
      "What this environment can actually compile: anchor-lang 0.29, " +
      "solana-program 1.16, the crate whitelist, TypeScript-only tests. " +
      "Load this before proposing a fix, and prefer it over any other " +
      "source when they disagree about versions.",
    source: { type: "bundled" },
  },
  {
    id: "solana-dev",
    name: "Official Solana developer skill",
    description:
      "The Solana Foundation's own skill (solana-foundation/solana-dev-skill): " +
      "common errors, security, testing, Anchor and @solana/kit references. " +
      "Teaches current versions, so check it against playground-env before " +
      "proposing code for this environment.",
    source: {
      type: "remote",
      baseUrl:
        "https://raw.githubusercontent.com/solana-foundation/" +
        "solana-dev-skill/main/skills/solana-dev/",
      entry: "SKILL.md",
    },
  },
];

/**
 * @typedef {object} McpUpstream
 * @property {string} id prefixes the server's tool names, so letters, digits,
 *   `-` and `_` only
 * @property {string} name
 * @property {string} url
 */

/**
 * The MCP servers every deployment offers without configuration. One that
 * needs a deployment secret (Explorer) is not a default: the gateway adds it
 * from the environment, for signed-in callers only.
 *
 * `api/mcp.mjs` still writes the Solana entry itself; switching it to this
 * export through `server.mjs` is the server rail's change.
 *
 * @type {readonly McpUpstream[]}
 */
export const DEFAULT_MCP_SERVERS = [
  {
    id: "solana",
    name: "Solana Developer MCP",
    url: "https://mcp.solana.com/mcp",
  },
];
