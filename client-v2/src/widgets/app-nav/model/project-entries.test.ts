import { listProjects } from "./project-entries";

const ids: Record<string, string> = {
  alpha: "id-a",
  beta: "id-b",
  "Hello Anchor": "id-h",
};
const deps = {
  idOf: (name: string) => ids[name],
  isLesson: (name: string) => name.startsWith("Hello "),
  progressOf: (name: string) => (name === "Hello Anchor" ? "3 of 4" : null),
};

describe("listProjects", () => {
  it("splits lessons from projects and keeps the given order", () => {
    const { projects, lessons } = listProjects(
      ["beta", "Hello Anchor", "alpha"],
      deps,
      []
    );
    expect(projects.map((p) => p.name)).toEqual(["beta", "alpha"]);
    expect(lessons.map((l) => l.name)).toEqual(["Hello Anchor"]);
    expect(lessons[0].progress).toBe("3 of 4");
    expect(projects[0].progress).toBeNull();
  });

  it("puts pinned entries first in their group, by workspace id", () => {
    const { projects } = listProjects(["beta", "alpha"], deps, ["id-a"]);
    expect(projects.map((p) => [p.name, p.pinned])).toEqual([
      ["alpha", true],
      ["beta", false],
    ]);
  });

  it("gives an entry the explorer has no id for no pin", () => {
    const { projects } = listProjects(["ghost"], deps, ["undefined"]);
    expect(projects[0]).toEqual({
      name: "ghost",
      id: null,
      isLesson: false,
      progress: null,
      pinned: false,
    });
  });

  it("handles an empty list", () => {
    expect(listProjects([], deps, [])).toEqual({ projects: [], lessons: [] });
  });
});
