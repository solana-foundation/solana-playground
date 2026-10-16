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

if (import.meta.vitest) {
  const { it, expect } = import.meta.vitest;

  it.each([
    ["panic", false, true],
    ["error", true, true],
    ["error", false, false],
    ["warn", true, true],
    ["warn", false, false],
    ["info", true, false],
    ["debug", true, false],
  ] as const)(
    "should report %s with report=%s: %s",
    (level, requested, reported) => {
      expect(isReported(level, requested)).toBe(reported);
    }
  );

  it.each([
    ["warn", "warn", true],
    ["error", "warn", true],
    ["info", "warn", false],
  ] as const)(
    "should treat %s as at least %s: %s",
    (level, threshold, expected) => {
      expect(atLeast(level, threshold)).toBe(expected);
    }
  );

  it.each([
    ["warn", true],
    ["verbose", false],
    ["toString", false],
  ])("should recognise %s as a level: %s", (value, expected) => {
    expect(isLevel(value)).toBe(expected);
  });
}
