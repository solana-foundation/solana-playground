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
      contextFiles: [
        { path: "src/lib.rs", content: "pub fn secret_sauce() {}" },
        { path: "tests/a.ts", content: "it('works')" },
      ],
      programId: null,
      idl: null,
      lesson: null,
      currentFilePath: "src/lib.rs",
      buildError: null,
    }),
    listFiles: () => ["src/lib.rs", "tests/a.ts", "secret/other.rs"],
  } as unknown as PlaygroundBridge;

  it("sends every file in the context in full", () => {
    const text = describeProject(bridge);
    expect(text).toContain(
      "Files in context (open tabs and files the user added; you can read only these): src/lib.rs, tests/a.ts"
    );
    expect(text).toContain("Active tab: src/lib.rs");
    expect(text).toContain("pub fn secret_sauce() {}");
    expect(text).toContain("it('works')");
  });

  it("names no path outside the context", () => {
    expect(describeProject(bridge)).not.toContain("secret/other.rs");
  });

  it("does not name an active tab the user removed from the context", () => {
    const removed = {
      getProjectContext: () => ({
        workspaceName: "counter",
        cluster: "devnet",
        walletConnected: false,
        contextFiles: [{ path: "tests/a.ts", content: "it('works')" }],
        programId: null,
        idl: null,
        lesson: null,
        currentFilePath: "src/lib.rs",
        buildError: null,
      }),
    } as unknown as PlaygroundBridge;
    expect(describeProject(removed)).not.toContain("src/lib.rs");
  });
});
