/** Where a skill's files come from */
export type SkillSource =
  /** Shipped in the bundle, so it survives a network failure */
  | { type: "bundled"; content: string }
  /**
   * Fetched at runtime. `baseUrl` must send `access-control-allow-origin`;
   * `raw.githubusercontent.com` sends `*`.
   */
  | { type: "remote"; baseUrl: string; entry: string };

/**
 * A body of ecosystem knowledge the model loads when it decides it needs it.
 *
 * Only `name` and `description` reach the prompt — the content arrives as a
 * tool result, which keeps the cached prompt prefix byte-stable.
 */
export interface SkillEntry {
  id: string;
  name: string;
  /** One line the model reads when deciding whether to load this */
  description: string;
  source: SkillSource;
}
