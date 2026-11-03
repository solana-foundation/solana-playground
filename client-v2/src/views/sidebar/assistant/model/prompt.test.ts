// The store and the bridge reach the `utils` barrel; only the text matters here
vi.mock("../store", () => ({ PgAssistant: { enabledSkillIds: [] } }));
vi.mock("../bridge/playground-bridge", () => ({ realBridge: {} }));

import { describeProject, systemPrompt } from "./prompt";
import type { PlaygroundBridge } from "../bridge/playground-bridge";

// `prompt.ts` imports the assistant context as `.md`: webpack hands it over
// as text, and so must the test runner (`markdownAsText` in vitest.config.ts)
describe("systemPrompt", () => {
  it("carries the assistant context as text, not a module", () => {
    expect(systemPrompt()).toContain("# Assistant context");
  });
});

describe("describeProject", () => {
  const bridge = (idl: unknown) =>
    ({
      getProjectContext: () => ({
        workspaceName: "p",
        currentFilePath: null,
        filePaths: [],
        openFilePaths: [],
        idl,
        programId: null,
        deployState: "ready",
        cluster: "devnet",
        walletConnected: false,
        lesson: null,
      }),
    } as unknown as PlaygroundBridge);

  it("names why the Playground cannot call a refused IDL", () => {
    expect(
      describeProject(
        bridge({
          name: "counter",
          instructions: [],
          accounts: [],
          refused: "a custom discriminator on initialize",
        })
      )
    ).toContain(
      "Program interface: counter — the Playground cannot call it: a custom discriminator on initialize"
    );
  });

  it("lists a callable IDL's instructions", () => {
    expect(
      describeProject(
        bridge({ name: "counter", instructions: ["increment"], accounts: [] })
      )
    ).toContain("Program interface: counter — instructions: increment");
  });
});
