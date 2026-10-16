import { hintPrompt, RUNG_COUNT } from "./hints";
import type { LessonStep } from "./types";

const step: LessonStep = {
  id: "greet",
  objective: "Give hello a name argument",
  verifiedBy: "the interface shows hello(name)",
  verify: { kind: "idl", instruction: "hello", arg: "name" },
  hints: [
    "Ask me a question that points at what I am missing.",
    "Name the concept and where to look.",
    "Propose the patch.",
  ],
};

describe("hintPrompt", () => {
  it("names the rung inside the prompt itself", () => {
    expect(hintPrompt(step, 1)).toContain(`Hint 1 of ${RUNG_COUNT}`);
    expect(hintPrompt(step, 3)).toContain(`Hint 3 of ${RUNG_COUNT}`);
  });

  it("carries the step's own text for the rung it is on", () => {
    expect(hintPrompt(step, 1)).toContain(step.hints[0]);
    expect(hintPrompt(step, 2)).toContain(step.hints[1]);
    expect(hintPrompt(step, 3)).toContain(step.hints[2]);
  });

  it("names the objective, so the assistant answers inside the step", () => {
    expect(hintPrompt(step, 1)).toContain(step.objective);
  });

  it("names the criterion, so the assistant aims at what proves it", () => {
    expect(hintPrompt(step, 1)).toContain(step.verifiedBy);
  });
});
