import { helloAnchorPath } from "./hello-anchor";
import { validatePath } from "../registry";
import { targetStage } from "../verify";

describe("the Hello Anchor path", () => {
  it("is valid against the tutorial it names", () => {
    expect(() => validatePath(helloAnchorPath, ["Hello Anchor"])).not.toThrow();
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
