import type {
  AccountLimitExceeded,
  LimitExceeded,
  ProjectLimitExceeded,
} from "../limits.mjs";

/** Which limit a refusal names, as the telemetry events report it */
export type LimitKind = "path" | "size" | "count" | "project";

const KINDS: Record<ProjectLimitExceeded["reason"], LimitKind> = {
  "path-too-long": "path",
  "file-too-large": "size",
  "too-many-files": "count",
  "project-too-large": "project",
};

export const limitKind = (limit: ProjectLimitExceeded): LimitKind =>
  KINDS[limit.reason];

/** Bytes as the user reads them: KB, rounded up so 1 byte over never reads as at the limit */
const kb = (bytes: number) => Math.ceil(bytes / 1024);

/** How much of a long path the banner shows */
const PATH_PREVIEW_CHARS = 60;

/** Up to three names, then how many more */
const listPaths = (paths: string[]) => {
  const shown = paths.slice(0, 3);
  const more = paths.length - shown.length;
  if (more > 0) return `${shown.join(", ")} and ${more} more`;
  if (shown.length === 1) return shown[0];
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
};

/**
 * The limit's rule on its own, for a refusal where what is over it is the
 * thing the user just tried: "A project can have at most 50 files."
 */
export const limitRule = (limit: ProjectLimitExceeded) => {
  switch (limit.reason) {
    case "path-too-long":
      return `A file path can be at most ${limit.limit} characters.`;
    case "file-too-large":
      return `A file can be at most ${kb(limit.limit)} KB.`;
    case "too-many-files":
      return `A project can have at most ${limit.limit} files.`;
    case "project-too-large":
      return `A project can be at most ${kb(limit.limit)} KB.`;
  }
};

/**
 * What is over the limit, then the limit: "This project has 64 files. A
 * project can have at most 50." An import refusal shows this.
 */
export const limitSummary = (limit: ProjectLimitExceeded) => {
  switch (limit.reason) {
    case "path-too-long": {
      const [first] = limit.paths;
      const cut = `${[...first].slice(0, PATH_PREVIEW_CHARS).join("")}…`;
      const more =
        limit.paths.length > 1 ? ` (and ${limit.paths.length - 1} more)` : "";
      return `A file path is longer than ${
        limit.limit
      } characters: ${cut}${more}. ${limitRule(limit)}`;
    }
    case "file-too-large": {
      const [only] = limit.paths;
      const size = limit.sizes?.[only];
      if (limit.paths.length === 1 && size !== undefined) {
        return `${only} is ${kb(size)} KB. ${limitRule(limit)}`;
      }
      const verb = limit.paths.length === 1 ? "is" : "are";
      return `${listPaths(limit.paths)} ${verb} over ${kb(
        limit.limit
      )} KB. ${limitRule(limit)}`;
    }
    case "too-many-files":
      return `This project has ${limit.count} files. A project can have at most ${limit.limit}.`;
    case "project-too-large":
      return `This project is ${kb(limit.size)} KB. ${limitRule(limit)}`;
  }
};

/** What the user does about it, the sync banner's last sentence */
const limitAction = (limit: ProjectLimitExceeded) => {
  switch (limit.reason) {
    case "path-too-long":
      return limit.paths.length === 1
        ? "Rename or move it, then try again."
        : "Rename or move them, then try again.";
    case "file-too-large":
      return limit.paths.length === 1
        ? "Shrink or remove it, then try again."
        : "Shrink or remove them, then try again.";
    case "too-many-files":
      return "Remove some, then try again.";
    case "project-too-large":
      return "Remove or shrink some files, then try again.";
  }
};

/**
 * The account cap, named by its figure only: the count the server sends
 * includes the project refused, which reads as "you have 11" to a user who
 * sees ten. The project is the user's work whether or not it syncs, so the
 * banner says it stays.
 */
const accountCapText = ({ kind, limit }: AccountLimitExceeded) => {
  const noun = kind === "tutorial" ? "tutorial" : "project";
  return `An account can sync at most ${limit} ${noun}s. This one stays in this browser and is not synced. Delete a synced ${noun} you no longer need, then try again.`;
};

/** The sync banner's text for a project stopped by a limit */
export const limitBannerText = (limit: LimitExceeded) =>
  limit.reason === "too-many-projects"
    ? accountCapText(limit)
    : `${limitSummary(limit)} ${limitAction(limit)}`;

if (import.meta.vitest) {
  const { describe, it, expect, beforeAll } = import.meta.vitest;

  describe("entities/project/model/describe", () => {
    let limits: typeof import("../limits.mjs").PROJECT_LIMITS;
    beforeAll(async () => {
      ({ PROJECT_LIMITS: limits } = await import("../limits.mjs"));
    });

    it("names one large file with its size", () => {
      expect(
        limitBannerText({
          reason: "file-too-large",
          limit: limits.fileBytes,
          paths: ["src/lib.rs"],
          sizes: { "src/lib.rs": 143_360 },
        })
      ).toBe(
        "src/lib.rs is 140 KB. A file can be at most 128 KB. Shrink or remove it, then try again."
      );
    });

    it("names the first three large files and counts the rest", () => {
      const paths: [string, ...string[]] = [
        "a.rs",
        "b.rs",
        "c.rs",
        "d.rs",
        "e.rs",
      ];
      expect(
        limitBannerText({
          reason: "file-too-large",
          limit: limits.fileBytes,
          paths,
          sizes: Object.fromEntries(
            paths.map((p) => [p, limits.fileBytes + 1])
          ),
        })
      ).toBe(
        "a.rs, b.rs, c.rs and 2 more are over 128 KB. A file can be at most 128 KB. Shrink or remove them, then try again."
      );
    });

    it("cuts a long path to 60 characters", () => {
      const path = "d/".repeat(200);
      const text = limitBannerText({
        reason: "path-too-long",
        limit: 256,
        paths: [path],
      });
      expect(text).toBe(
        `A file path is longer than 256 characters: ${path.slice(
          0,
          60
        )}…. A file path can be at most 256 characters. Rename or move it, then try again.`
      );
    });

    it("words the file count", () => {
      expect(
        limitBannerText({ reason: "too-many-files", limit: 50, count: 64 })
      ).toBe(
        "This project has 64 files. A project can have at most 50. Remove some, then try again."
      );
      expect(
        limitSummary({ reason: "too-many-files", limit: 50, count: 64 })
      ).toBe("This project has 64 files. A project can have at most 50.");
    });

    it("words the project size in KB, rounded up", () => {
      expect(
        limitBannerText({
          reason: "project-too-large",
          limit: limits.projectBytes,
          size: 614_400,
        })
      ).toBe(
        "This project is 600 KB. A project can be at most 512 KB. Remove or shrink some files, then try again."
      );
      expect(
        limitSummary({
          reason: "project-too-large",
          limit: limits.projectBytes,
          size: 524_289,
        })
      ).toBe("This project is 513 KB. A project can be at most 512 KB.");
    });

    it("names the account cap by its figure and says the project stays", () => {
      expect(
        limitBannerText({
          reason: "too-many-projects",
          kind: "project",
          limit: 10,
          count: 11,
        })
      ).toBe(
        "An account can sync at most 10 projects. This one stays in this browser and is not synced. Delete a synced project you no longer need, then try again."
      );
      expect(
        limitBannerText({
          reason: "too-many-projects",
          kind: "tutorial",
          limit: 32,
          count: 33,
        })
      ).toBe(
        "An account can sync at most 32 tutorials. This one stays in this browser and is not synced. Delete a synced tutorial you no longer need, then try again."
      );
    });

    it("states each rule on its own", () => {
      expect(
        [
          { reason: "path-too-long", limit: 256, paths: ["x"] },
          {
            reason: "file-too-large",
            limit: limits.fileBytes,
            paths: ["x"],
            sizes: {},
          },
          { reason: "too-many-files", limit: 50, count: 51 },
          {
            reason: "project-too-large",
            limit: limits.projectBytes,
            size: 1,
          },
        ].map((limit) => limitRule(limit as ProjectLimitExceeded))
      ).toEqual([
        "A file path can be at most 256 characters.",
        "A file can be at most 128 KB.",
        "A project can have at most 50 files.",
        "A project can be at most 512 KB.",
      ]);
    });
  });
}
