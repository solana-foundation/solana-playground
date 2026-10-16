import type { LessonPath } from "./types";

/**
 * Fail at module load rather than at demo time, the way
 * `createTutorial` already throws on too many categories.
 *
 * @param path the path to check
 * @param tutorialNames every name in `TUTORIALS`
 */
export const validatePath = (path: LessonPath, tutorialNames: string[]) => {
  if (!tutorialNames.includes(path.tutorial)) {
    throw new Error(
      `Lesson path targets "${path.tutorial}", which is not a tutorial`
    );
  }

  if (path.steps.length === 0) {
    throw new Error(`Lesson path "${path.tutorial}" needs at least one step`);
  }

  const seen = new Set<string>();
  for (const step of path.steps) {
    if (seen.has(step.id)) {
      throw new Error(
        `Lesson path "${path.tutorial}" has a duplicate step id "${step.id}"`
      );
    }
    seen.add(step.id);

    if (step.verify.kind === "idl" && !step.verify.instruction) {
      throw new Error(
        `Step "${step.id}" verifies against the IDL but names no instruction`
      );
    }
  }
};

let paths: LessonPath[] = [];

/** Validate and install the paths the app knows about. */
export const registerPaths = (next: LessonPath[], tutorialNames: string[]) => {
  for (const path of next) validatePath(path, tutorialNames);
  paths = next;
};

/**
 * @param tutorialName the current workspace name
 * @returns the path for that tutorial, or `null` when it has none -- which
 * is the normal case for the tutorials we have not converted
 */
export const getLessonPath = (tutorialName: string | null | undefined) => {
  if (!tutorialName) return null;
  return paths.find((p) => p.tutorial === tutorialName) ?? null;
};

if (import.meta.vitest) {
  const { describe, it, expect, beforeEach } = import.meta.vitest;

  const TUTORIALS = ["Hello Anchor", "Hello Solana"];

  const validPath: LessonPath = {
    tutorial: "Hello Anchor",
    steps: [
      {
        id: "write",
        objective: "Define the hello instruction",
        verifiedBy: "the interface shows hello",
        verify: { kind: "idl", instruction: "hello" },
        hints: ["one", "two", "three"],
      },
      {
        id: "deploy",
        objective: "Deploy it to devnet",
        verifiedBy: "the program is on devnet",
        verify: { kind: "deployed" },
        hints: ["one", "two", "three"],
      },
    ],
  };

  describe("validatePath", () => {
    it("accepts a well-formed path", () => {
      expect(() => validatePath(validPath, TUTORIALS)).not.toThrow();
    });

    it("rejects a tutorial that does not exist", () => {
      const path = { ...validPath, tutorial: "No Such Tutorial" };
      expect(() => validatePath(path, TUTORIALS)).toThrow(/No Such Tutorial/);
    });

    it("rejects duplicate step ids", () => {
      const path: LessonPath = {
        ...validPath,
        steps: [validPath.steps[0], { ...validPath.steps[1], id: "write" }],
      };
      expect(() => validatePath(path, TUTORIALS)).toThrow(/duplicate step id/i);
    });

    it("rejects an empty path", () => {
      expect(() =>
        validatePath({ ...validPath, steps: [] }, TUTORIALS)
      ).toThrow(/at least one step/i);
    });

    it("rejects an idl condition with no instruction", () => {
      const path: LessonPath = {
        ...validPath,
        steps: [
          {
            ...validPath.steps[0],
            verify: { kind: "idl", instruction: "" },
          },
        ],
      };
      expect(() => validatePath(path, TUTORIALS)).toThrow(/instruction/i);
    });
  });

  describe("registry", () => {
    beforeEach(() => registerPaths([validPath], TUTORIALS));

    it("finds a path by tutorial name", () => {
      expect(getLessonPath("Hello Anchor")?.steps).toHaveLength(2);
    });

    it("returns null for a tutorial with no path", () => {
      expect(getLessonPath("Hello Solana")).toBeNull();
    });

    it("returns null for no workspace", () => {
      expect(getLessonPath(null)).toBeNull();
      expect(getLessonPath(undefined)).toBeNull();
    });

    it("validates every path it registers", () => {
      const bad = { ...validPath, tutorial: "Nope" };
      expect(() => registerPaths([bad], TUTORIALS)).toThrow(/Nope/);
    });
  });
}
