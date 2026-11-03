import { TUTORIALS } from "../../../tutorials";
import { LESSON_PATHS } from "./paths";
import { registerPaths } from "./registry";

// Runs on the barrel's first import, from whichever module loads it; until then `getLessonPath` returns null for every tutorial
registerPaths(
  LESSON_PATHS,
  TUTORIALS.map((t) => t.name)
);

export {
  attempted,
  cursorStep,
  foldRecord,
  legal,
  nextLegal,
  positionNumber,
  prevLegal,
  rung,
} from "./ledger";
export type { LessonView } from "./ledger";
export { describeStep } from "./band-copy";
export { getLessonPath } from "./registry";
export { graderClass, targetStage, verifyingStage } from "./verify";
export { INITIAL_LESSON_STATE, PgLesson } from "./store";
export type { LessonState } from "./store";
