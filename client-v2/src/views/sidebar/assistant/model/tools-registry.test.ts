// `@types/mocha` also declares a global `it`, without `each`
import { it } from "vitest";
import { createTools } from "./tools";
import { PgAssistant } from "../store";
import { BUILTIN_TOOLS } from "@/entities/agent-tools";
import type { PlaygroundBridge } from "../bridge/playground-bridge";

// A second file for `tools.ts`: these cases need the real skill tools, which
// `tools.test.ts` mocks away for the whole file
vi.mock("./mcp-tools", () => ({ createMcpTools: () => [] }));
// Only the default value is needed here; reaching the real one drags in the
// utils barrel, which wants webpack-injected globals
vi.mock("../bridge/playground-bridge", () => ({ realBridge: {} }));

/** A bridge that records every call that would change the project */
const recordingBridge = () => {
  const changes: string[] = [];
  const bridge = {
    listFiles: () => [],
    readFile: () => "old",
    getProjectContext: () => ({ cluster: "devnet", buildError: null }),
    applyPatch: async () => void changes.push("applyPatch"),
    build: async () => void changes.push("build"),
    deploy: async () => void changes.push("deploy"),
  } as unknown as PlaygroundBridge;
  return { bridge, changes };
};

/** Arguments that get each tool past its input checks */
const INPUT: Record<string, Record<string, unknown>> = {
  list_skills: {},
  load_skill: { id: "playground-env" },
  read_skill_reference: { id: "playground-env", path: "references/x.md" },
  list_files: {},
  read_file: { path: "src/lib.rs" },
  get_build_error: {},
  write_file: { path: "src/lib.rs", content: "new" },
  build: {},
  deploy: {},
};

/** The input for a tool, failing by name when a new tool has none here */
const inputFor = (name: string) => {
  expect(INPUT, `add sample input for ${name}`).toHaveProperty(name);
  return INPUT[name];
};

const approvalCards = () =>
  PgAssistant.items.filter((item) => item.kind === "approval");

beforeEach(() => PgAssistant.clear());

describe("the panel's built-in tools", () => {
  it("are exactly the registry's declarations, unchanged", () => {
    const panel = createTools(recordingBridge().bridge).map(
      ({ name, description, schema }) => ({ name, description, schema })
    );
    const declared = BUILTIN_TOOLS.map(({ name, description, schema }) => ({
      name,
      description,
      schema,
    }));

    expect(panel).toEqual(declared);
  });

  it.each(
    BUILTIN_TOOLS.filter((tool) => tool.approval).map((tool) => [tool.name])
  )("%s asks for approval and changes nothing when declined", async (name) => {
    const { bridge, changes } = recordingBridge();
    const tool = createTools(bridge).find((t) => t.name === name)!;

    const pending = tool.run(inputFor(name));
    await vi.waitFor(() => expect(approvalCards()).toHaveLength(1));
    PgAssistant.resolveApproval(approvalCards()[0].id, false);
    await pending;

    expect(changes).toEqual([]);
  });

  // The flag is what the server rail will read to decide whether to pause, so
  // an unmarked tool that changed the project would act without asking
  it.each(
    BUILTIN_TOOLS.filter((tool) => !tool.approval).map((tool) => [tool.name])
  )("%s neither asks nor changes anything", async (name) => {
    const { bridge, changes } = recordingBridge();
    const tool = createTools(bridge).find((t) => t.name === name)!;

    await tool.run(inputFor(name));

    expect(approvalCards()).toEqual([]);
    expect(changes).toEqual([]);
  });
});
