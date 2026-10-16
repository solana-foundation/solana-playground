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
