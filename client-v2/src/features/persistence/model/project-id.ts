import { TUTORIAL_ID_PREFIX } from "./project-write.mjs";
import { PgCommon } from "../../../utils/common";

/**
 * The id of the project a tutorial runs in.
 *
 * Derived rather than minted: a tutorial is the same thing on every device, so
 * two devices must agree on its id without talking to each other. A personal
 * project gets a uuid instead, because two projects that happen to share a
 * name are not the same project.
 *
 * The `tut:` prefix keeps it out of the uuid space, so the two kinds can share
 * one `projects.id` column without any chance of collision.
 */
export const tutorialProjectId = (name: string) =>
  `${TUTORIAL_ID_PREFIX}${PgCommon.toKebabFromTitle(name)}`;

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("features/persistence/model/project-id", () => {
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
  });
}
