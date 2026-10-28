import type { ModelShown } from "./choice";
import type { KeyedProviderId } from "./connection";

/**
 * What the assistant's head reads: plain words while there is no model to
 * name, or the model's name between the words around it, of which only
 * `model` may be cut
 */
export type HeadLabel =
  | { kind: "plain"; text: string }
  | { kind: "model"; lead: string; model: string; tail: string };

/** The head's words whole, as one string: its accessible name */
export const headText = (label: HeadLabel) =>
  label.kind === "plain"
    ? label.text
    : `${label.lead}${label.model}${label.tail}`;

/**
 * Whose key a keyed model runs on, as "your … key" reads it. Not
 * `PROVIDERS`' names: "your OpenAI-compatible key" says nothing to a person.
 */
const KEY_OWNER: Record<KeyedProviderId, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  openrouter: "OpenRouter",
  gemini: "Gemini",
};

/**
 * What the assistant's head reads for the model the composer shows: the
 * model, and whether it is hosted or runs on the person's own key
 */
export const headLabel = (shown: ModelShown): HeadLabel => {
  switch (shown.kind) {
    case "default":
      return {
        kind: "model",
        lead: "Assistant · ",
        model: shown.label,
        tail: " · hosted",
      };
    case "keyed":
      return {
        kind: "model",
        lead: "",
        model: shown.label,
        tail: ` · your ${KEY_OWNER[shown.provider]} key`,
      };
    case "none":
    case "checking":
      return { kind: "plain", text: "Assistant" };
  }
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("widgets/assistant/model/head-label", () => {
    it("names the hosted model as hosted", () => {
      expect(
        headLabel({ kind: "default", label: "GLM 5.3 Flash", connected: true })
      ).toEqual({
        kind: "model",
        lead: "Assistant · ",
        model: "GLM 5.3 Flash",
        tail: " · hosted",
      });
    });

    it("names a keyed model with the provider whose key it runs on", () => {
      expect(
        headLabel({
          kind: "keyed",
          provider: "openrouter",
          model: "deepseek/deepseek-chat-v3.1:free",
          label: "deepseek/deepseek-chat-v3.1:free",
          effort: null,
        })
      ).toEqual({
        kind: "model",
        lead: "",
        model: "deepseek/deepseek-chat-v3.1:free",
        tail: " · your OpenRouter key",
      });
    });

    // OpenAI, not the provider list's "OpenAI-compatible"
    it.each([
      ["anthropic", "Anthropic"],
      ["openai", "OpenAI"],
      ["openrouter", "OpenRouter"],
      ["gemini", "Gemini"],
    ] as const)("names %s's key as %s's", (provider, owner) => {
      const label = headLabel({
        kind: "keyed",
        provider,
        model: "m",
        label: "m",
        effort: null,
      });
      expect(headText(label)).toBe(`m · your ${owner} key`);
    });

    it("reads Assistant alone with no model, and while checking", () => {
      const alone = { kind: "plain", text: "Assistant" };
      expect(headLabel({ kind: "none" })).toEqual(alone);
      expect(headLabel({ kind: "checking" })).toEqual(alone);
    });

    it("reads the head whole as one string", () => {
      expect(
        headText(
          headLabel({
            kind: "default",
            label: "GLM 5.3 Flash",
            connected: true,
          })
        )
      ).toBe("Assistant · GLM 5.3 Flash · hosted");
    });
  });
}
