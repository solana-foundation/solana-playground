/** Model requests one assistant turn may send, not counting resumes of a paused turn */
export const MAX_STEPS = 12;

/** Times one assistant turn may resume after the provider paused it */
export const MAX_RESUMES = 3;

/** Output budget of an Anthropic turn; thinking counts toward it even though its text is not returned */
export const ANTHROPIC_MAX_OUTPUT_TOKENS = 64_000;

/** Same-origin route of the default backend, whose upstream and key are configured server-side */
export const DEFAULT_BACKEND_URL = "/api/agent";
