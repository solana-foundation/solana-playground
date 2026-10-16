/** Display names for model ids the product ships with; anything else is shown as it is */
const NAMES: Record<string, string> = {
  "z-ai/glm-5.3-flash:US": "GLM 5.3 Flash",
  "claude-opus-5-5": "Opus 5.5",
  "claude-sonnet-5-5": "Sonnet 5.5",
  "gemini-3.6-flash": "Gemini 3.6 Flash",
  "gemini-3.1-pro-preview": "Gemini 3.1 Pro",
};

export const displayModelName = (id: string) => NAMES[id] ?? id;
