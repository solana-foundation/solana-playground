import { groupWorkspaces } from "./workspaces";

const isLesson = (n: string) => n.startsWith("Hello ");
const progressOf = (n: string) => (n === "Hello Anchor" ? "3/4" : null);

describe("groupWorkspaces", () => {
  it("splits lessons from projects", () => {
    const { lessons, projects } = groupWorkspaces(
      ["flow-demo", "Hello Anchor", "token-vault", "Hello Solana"],
      isLesson,
      progressOf
    );
    expect(lessons.map((l) => l.name)).toEqual([
      "Hello Anchor",
      "Hello Solana",
    ]);
    expect(projects.map((p) => p.name)).toEqual(["flow-demo", "token-vault"]);
  });

  it("carries progress for a lesson and none for a project", () => {
    const { lessons, projects } = groupWorkspaces(
      ["flow-demo", "Hello Anchor"],
      isLesson,
      progressOf
    );
    expect(lessons[0].progress).toBe("3/4");
    expect(projects[0].progress).toBeNull();
  });

  it("preserves the order it was given inside each group", () => {
    const { projects } = groupWorkspaces(
      ["zeta", "alpha"],
      isLesson,
      progressOf
    );
    expect(projects.map((p) => p.name)).toEqual(["zeta", "alpha"]);
  });

  it("handles an empty list", () => {
    expect(groupWorkspaces([], isLesson, progressOf)).toEqual({
      lessons: [],
      projects: [],
    });
  });
});
