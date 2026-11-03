// The store and the bridge reach the `utils` barrel; only the text matters here
const store = vi.hoisted(() => ({
  PgAssistant: { enabledSkills: [] as unknown[] },
}));
vi.mock("../store", () => store);
vi.mock("../bridge/playground-bridge", () => ({ realBridge: {} }));

import { describeProjectWith, systemPrompt } from "./prompt";
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
    /* eslint-enable unicorn/no-null */
    listFiles: () => ["src/lib.rs", "tests/a.ts", "secret/other.rs"],
  } as unknown as PlaygroundBridge;

  it("sends every file in the context in full", () => {
    const text = describeProjectWith(bridge);
    expect(text).toContain(
      "Files in context (open tabs and files the user added; you can read only these): src/lib.rs, tests/a.ts"
    );
    expect(text).toContain("Active tab: src/lib.rs");
    expect(text).toContain("pub fn secret_sauce() {}");
    expect(text).toContain("it('works')");
  });

  it("names no path outside the context", () => {
    expect(describeProjectWith(bridge)).not.toContain("secret/other.rs");
  });

  it("does not name an active tab the user removed from the context", () => {
    const removed = {
      /* eslint-disable unicorn/no-null -- `ProjectContext` types these fields `| null` */
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
      /* eslint-enable unicorn/no-null */
    } as unknown as PlaygroundBridge;
    expect(describeProjectWith(removed)).not.toContain("src/lib.rs");
  });
});
