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
  `tut:${PgCommon.toKebabFromTitle(name)}`;
