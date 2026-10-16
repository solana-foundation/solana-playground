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
