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
  const bridge = {
    getProjectContext: () => ({
      workspaceName: "counter",
      cluster: "devnet",
      walletConnected: false,
      filePaths: ["src/lib.rs"],
      openFilePaths: ["src/lib.rs"],
      programId: null,
      idl: null,
      lesson: null,
      currentFilePath: "src/lib.rs",
      currentFileContent: "pub fn secret_sauce() {}",
      buildError: null,
    }),
  } as unknown as PlaygroundBridge;

  it("sends the open file in full by default", () => {
    expect(describeProject(bridge)).toContain("pub fn secret_sauce() {}");
  });

  it("names the open file without its content when the user left it out", () => {
    const text = describeProject(bridge, { openFile: false });
    expect(text).toContain("src/lib.rs");
    expect(text).not.toContain("pub fn secret_sauce() {}");
    expect(text).toContain("left its content out of this message");
  });
});
