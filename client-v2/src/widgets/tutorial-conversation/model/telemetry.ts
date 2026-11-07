/**
 * The feed's events, `tutorial_step_jumped` and `tutorial_step_back`, are
 * declared on `entities/tutorial`'s tracker: the spec names them with the
 * `tutorial` prefix, and a prefix belongs to one slice. This module is the
 * widget's own door to that tracker.
 */
export { tutorialTelemetry } from "@/entities/tutorial";
