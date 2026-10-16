import { tutorialProjectId } from "./project-id";

describe("tutorialProjectId", () => {
  it("is deterministic, so one tutorial is one thread on every device", () => {
    expect(tutorialProjectId("Hello Anchor")).toBe("tut:hello-anchor");
    expect(tutorialProjectId("Hello Anchor")).toBe(
      tutorialProjectId("Hello Anchor")
    );
  });

  it("distinguishes different tutorials", () => {
    expect(tutorialProjectId("Hello Solana")).not.toBe(
      tutorialProjectId("Hello Anchor")
    );
  });

  it("is namespaced, so it cannot collide with a project uuid", () => {
    expect(tutorialProjectId("Hello Anchor").startsWith("tut:")).toBe(true);
  });
});
