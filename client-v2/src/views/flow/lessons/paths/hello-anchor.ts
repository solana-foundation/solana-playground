import type { LessonPath } from "../types";

/**
 * A verified path over upstream's `hello-anchor` tutorial.
 *
 * The prose is upstream's, loaded unedited from
 * `src/tutorials/hello-anchor/pages/`. Only the objectives, the
 * verification conditions and the hints are ours, so an upstream sync
 * keeps flowing through.
 *
 * Step 1 is satisfied only once a build has run, which is the point: you
 * find out by building, not by asserting. Step 3 is a reading step
 * because nothing free proves a client call happened -- the honest limit
 * of this cut, and the first thing log verification would fix.
 */
export const helloAnchorPath: LessonPath = {
  tutorial: "Hello Anchor",
  steps: [
    {
      id: "write-program",
      objective: "Define the hello instruction and log a message",
      verifiedBy: "the built interface shows a hello instruction",
      verify: { kind: "idl", instruction: "hello" },
      readPage: () => require("../../../../tutorials/hello-anchor/pages/1.md"),
      hints: [
        "Ask me one question about what my program is still missing. Name no API and show no code.",
        "Name the Anchor macro I still need and the part of lib.rs it belongs in. Do not write the code for me.",
        "Propose the patch to lib.rs and explain each changed line.",
      ],
    },
    {
      id: "deploy",
      objective: "Deploy the program to devnet",
      verifiedBy: "the program is live on devnet",
      verify: { kind: "deployed" },
      readPage: () => require("../../../../tutorials/hello-anchor/pages/2.md"),
      hints: [
        "Ask me one question about what has to be true before a deploy can succeed.",
        "Name what my wallet or my build is missing, and where in the UI to see it. Do not act for me.",
        "Walk me through the deploy, one action at a time.",
      ],
    },
    {
      id: "call-client",
      objective: "Call the instruction from the TypeScript client",
      verifiedBy: "you have marked this page as read",
      verify: { kind: "read", at: "interact" },
      readPage: () => require("../../../../tutorials/hello-anchor/pages/3.md"),
      hints: [
        "Ask me one question about how the client knows my program's interface.",
        "Name where the generated client comes from and which file calls it. Do not write it for me.",
        "Propose the client code and explain each line.",
      ],
    },
    {
      id: "greet-by-name",
      objective: "Give hello a name argument and log it",
      verifiedBy: "the built interface shows hello taking a name",
      verify: { kind: "idl", instruction: "hello", arg: "name" },
      readPage: () => require("../../../../tutorials/hello-anchor/pages/4.md"),
      hints: [
        "Ask me one question about what an instruction argument has to be for Anchor to serialize it. Show no code.",
        "Name the Rust type this argument needs and the two places it has to change. Do not write the patch.",
        "Propose the patch to lib.rs and the test, and explain each changed line.",
      ],
    },
  ],
};

if (import.meta.vitest) {
  const { describe, it, expect, beforeAll } = import.meta.vitest;
  let validatePath: typeof import("../registry").validatePath;
  let targetStage: typeof import("../verify").targetStage;
  beforeAll(async () => {
    ({ validatePath } = await import("../registry"));
    ({ targetStage } = await import("../verify"));
  });
  describe("the Hello Anchor path", () => {
    it("is valid against the tutorial it names", () => {
      expect(() =>
        validatePath(helloAnchorPath, ["Hello Anchor"])
      ).not.toThrow();
    });

    it("has four steps", () => {
      expect(helloAnchorPath.steps).toHaveLength(4);
    });

    it("ends by checking that hello gained a name argument", () => {
      const last = helloAnchorPath.steps[3];
      expect(last.verify).toEqual({
        kind: "idl",
        instruction: "hello",
        arg: "name",
      });
    });

    it("gives every step three hints and a derivable target stage", () => {
      for (const step of helloAnchorPath.steps) {
        expect(step.hints).toHaveLength(3);
        expect(["write", "build", "deploy", "interact"]).toContain(
          targetStage(step.verify)
        );
      }
    });

    it("never promises a check it cannot make", () => {
      // The cut verifies the build, the deploy and the IDL. A step whose
      // `verifiedBy` mentions a transaction would be overclaiming -- see
      // the spec's honesty map.
      for (const step of helloAnchorPath.steps) {
        expect(step.verifiedBy.toLowerCase()).not.toContain("transaction");
      }
    });

    it("never claims a read step observed program behaviour", () => {
      // A `read` step's `verify` checks nothing -- the ratchet only
      // advances it on a manual "Continue". Its `verifiedBy` must not
      // describe a build, a deploy or a client run as something the app
      // witnessed, since that is exactly the false claim this suite
      // exists to catch (see the spec's honesty map). Chosen words: past
      // participles and nouns an honest, self-reported phrasing
      // ("you have marked this page as read") would never need.
      for (const step of helloAnchorPath.steps) {
        if (step.verify.kind !== "read") continue;
        expect(step.verifiedBy).not.toMatch(
          /\b(built|interface|deployed|devnet|logged|ran|output)\b/i
        );
      }
    });

    it("loads its prose from the tutorial", async () => {
      const page = await helloAnchorPath.steps[0].readPage?.();
      expect(typeof page).toBe("string");
      expect(page).toContain("Anchor");
    });
  });
}
