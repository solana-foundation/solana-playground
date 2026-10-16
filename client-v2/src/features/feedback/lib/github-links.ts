const ISSUES = "https://github.com/solana-foundation/solana-playground/issues";

/** Both open the Foundation's issue list: a label in a new-issue link applies only for people with triage rights */
export const GITHUB_LINKS = {
  idea: ISSUES,
  bug: ISSUES,
} as const;

/** Which link the user picked, for telemetry; both open the same page */
export type GithubLink = keyof typeof GITHUB_LINKS;
