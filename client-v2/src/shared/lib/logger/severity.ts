interface Severity {
  /** 0 is the most severe; a threshold lets through its own rank and those below it */
  rank: number;
  /** Whether an entry reaches error tracking: always, when logged with `report: true`, or never */
  report: "always" | "on-request" | "never";
}

export type Level = "panic" | "error" | "warn" | "info" | "debug";

/** The one definition of each level; providers map a level to their vendor's name for it */
export const SEVERITY: Readonly<Record<Level, Severity>> = {
  panic: { rank: 0, report: "always" },
  error: { rank: 1, report: "on-request" },
  warn: { rank: 2, report: "on-request" },
  info: { rank: 3, report: "never" },
  debug: { rank: 4, report: "never" },
};

export const isLevel = (value: unknown): value is Level =>
  typeof value === "string" && Object.hasOwn(SEVERITY, value);

/** Whether `level` is as severe as `threshold` or more */
export const atLeast = (level: Level, threshold: Level) =>
  SEVERITY[level].rank <= SEVERITY[threshold].rank;

/** Whether an entry at `level` reaches error tracking, given the caller's `report` option */
export const isReported = (level: Level, requested: boolean) => {
  const { report } = SEVERITY[level];
  return report === "always" || (report === "on-request" && requested);
};
