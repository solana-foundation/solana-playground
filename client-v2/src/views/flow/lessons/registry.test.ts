import { getLessonPath, registerPaths, validatePath } from "./registry";
import type { LessonPath } from "./types";

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
    expect(() => validatePath({ ...validPath, steps: [] }, TUTORIALS)).toThrow(
      /at least one step/i
    );
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
