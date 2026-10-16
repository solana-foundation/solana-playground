import { describe, expect, it } from "vitest";
import { displayModelName } from "./model-name";

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
