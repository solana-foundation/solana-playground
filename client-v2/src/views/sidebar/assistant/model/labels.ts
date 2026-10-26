import type { Effort } from "./types";

/** The words for each effort level, in the composer's menu and on Connect a model */
export const EFFORT_LABELS: Record<Effort, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

/** Display names for model ids the product ships with; anything else is shown as it is */
const NAMES: Record<string, string> = {
  "z-ai/glm-5.3-flash:US": "GLM 5.3 Flash",
  "claude-opus-5-5": "Opus 5.5",
  "claude-sonnet-5-5": "Sonnet 5.5",
  "gemini-3.6-flash": "Gemini 3.6 Flash",
  "gemini-3.1-pro-preview": "Gemini 3.1 Pro",
};

export const displayModelName = (id: string) => NAMES[id] ?? id;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("views/sidebar/assistant/model/labels", () => {
    describe("displayModelName", () => {
      it("names the hosted default", () => {
        expect(displayModelName("z-ai/glm-5.3-flash:US")).toBe("GLM 5.3 Flash");
      });
      it("names the Anthropic models", () => {
        expect(displayModelName("claude-opus-5-5")).toBe("Opus 5.5");
        expect(displayModelName("claude-sonnet-5-5")).toBe("Sonnet 5.5");
      });
      it("shows an unknown id as it is", () => {
        expect(displayModelName("deepseek/deepseek-chat-v3.1:free")).toBe(
          "deepseek/deepseek-chat-v3.1:free"
        );
      });
    });
  });
}
