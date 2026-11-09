import type { Stage } from "./stage";

/** What the product calls each stage. Kept out of `stage.ts`, which imports the playground runtime */
export const STAGE_LABEL: Record<Stage, string> = {
  write: "Write",
  build: "Build",
  deploy: "Deploy",
  interact: "Interact",
};
