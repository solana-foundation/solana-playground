// The store and the bridge reach the `utils` barrel; only the text matters here
vi.mock("../store", () => ({ PgAssistant: { enabledSkillIds: [] } }));
vi.mock("../bridge/playground-bridge", () => ({ realBridge: {} }));

import { systemPrompt } from "./prompt";

// `prompt.ts` imports the assistant context as `.md`: webpack hands it over
// as text, and so must the test runner (`markdownAsText` in vitest.config.ts)
describe("systemPrompt", () => {
  it("carries the assistant context as text, not a module", () => {
    expect(systemPrompt()).toContain("# Assistant context");
  });
});
