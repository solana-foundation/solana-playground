/**
 * The slice's events, `tutorial_opened`, `tutorial_started`,
 * `tutorial_step_reset` and `tutorial_finished`, are declared on
 * `entities/tutorial`'s tracker: the
 * spec names them with the `tutorial` prefix, and a prefix belongs to one
 * slice. This module is the slice's own door to that tracker.
 */
export { tutorialTelemetry } from "@/entities/tutorial";
