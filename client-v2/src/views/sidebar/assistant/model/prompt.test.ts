// The store and the bridge reach the `utils` barrel; only the text matters here
const store = vi.hoisted(() => ({
  PgAssistant: { enabledSkills: [] as unknown[] },
}));
vi.mock("../store", () => store);
vi.mock("../bridge/playground-bridge", () => ({ realBridge: {} }));

import { describeProjectWith, systemPrompt } from "./prompt";
import { EVERYTHING } from "./types";
import type { PlaygroundBridge } from "../bridge/playground-bridge";

// `prompt.ts` imports the assistant context as `.md`: webpack hands it over
// as text, and so must the test runner (`markdownAsText` in vitest.config.ts)
describe("systemPrompt", () => {
  it("carries the assistant context as text, not a module", () => {
    expect(systemPrompt()).toContain("# Assistant context");
  });

  it("names in its catalogue only the skills the server listed and the user has on", () => {
    store.PgAssistant.enabledSkills = [
      {
        id: "playground-env",
        name: "Playground build environment",
        description: "What compiles here.",
        source: { type: "bundled", content: "" },
        enabled: true,
      },
    ];

    expect(systemPrompt()).toContain(
      "- playground-env (Playground build environment): What compiles here."
    );
    expect(systemPrompt()).not.toContain("- solana-dev (");
  });
});

describe("describeProject", () => {
  const bridge = {
    /* eslint-disable unicorn/no-null -- `ProjectContext` types these fields `| null` */
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
    /* eslint-enable unicorn/no-null */
  } as unknown as PlaygroundBridge;

  it("sends the open file in full by default", () => {
    expect(describeProjectWith(bridge)(EVERYTHING)).toContain(
      "pub fn secret_sauce() {}"
    );
  });

  it("names the open file without its content when the user left it out", () => {
    const text = describeProjectWith(bridge)({ openFile: false });
    expect(text).toContain("src/lib.rs");
    expect(text).not.toContain("pub fn secret_sauce() {}");
    expect(text).toContain("left its content out of this message");
  });
});
