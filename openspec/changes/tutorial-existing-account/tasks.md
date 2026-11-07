# Tasks

## 1. Existing accounts pass a call goal (HOO-2362)

- [x] 1.1 Add `goal.creates` and `win.existsLine` to `tutorial.schema.json`, the definition types and `checkDefinition`, document them in `AUTHORING.md`, and opt Lumberjack's and Zero Copy's step 2 in; verify with the check's in-source tests and `yarn test-unit src/tutorials src/entities/tutorial`
- [x] 1.2 Mark the existing account on a failed run or call (`exists`), from the System Program's "already in use" refusal and, for a client run that sent nothing, from the account at its seeds' address; pass the goal on it in `judgeGoal`, record it as accepted, save `reason: "exists"` with the step's pass and send it on `tutorial_step_passed`; verify with the goals, runner and reducer tests and the engine test that reads the event through the memory provider (depends on 1.1)
- [x] 1.3 Show "Already exists" on the result card and in the Call panel, and the win's `existsLine` on that path; verify with the widget tests that the explanation shows on the existing-account pass and not on a normal pass (depends on 1.2)
