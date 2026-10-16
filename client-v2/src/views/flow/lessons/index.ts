import { LESSON_PATHS } from "./paths";
import { registerPaths } from "./registry";
import { TUTORIALS } from "../../../tutorials";

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
export { describeStep, positionLabel } from "./band-copy";
export { entryReading } from "./reading";
export { getLessonPath } from "./registry";
export { graderClass, targetStage, verifyingStage } from "./verify";
export { INITIAL_LESSON_STATE, PgLesson } from "./store";
export type { LessonState } from "./store";
