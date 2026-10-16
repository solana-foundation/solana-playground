import { describeCatalog } from "../grounding";
import { PgAssistant } from "../store";
import { realBridge, type PlaygroundBridge } from "../bridge/playground-bridge";
import assistantContext from "../content/assistant-context.md";

/**
 * How the assistant should behave.
 *
 * Byte-stable across turns and across providers, which is what lets it be
 * cached where the provider supports it.
 */
export const BEHAVIOUR = `You are the assistant built into Solana Playground, a browser IDE for Solana programs.

You can read the user's project, propose changes to it, and run builds and deploys. Reads happen immediately. Anything that changes state — writing a file, building, deploying — is shown to the user and only happens if they click to approve it. Never claim you have changed, built or deployed something until a tool result says you did.

How to work:

- Read before you propose. Call read_file so a change matches what is actually in the file.
- When a build fails, call get_build_error and explain the compiler's actual message against the user's actual code. Quote the real line. Do not give generic Rust advice.
- Propose the smallest change that fixes the problem. Send complete file content to write_file, not a fragment.
- Solana specifics matter: programs are Rust compiled server-side, tests are TypeScript run from the browser against the configured cluster, and the crate list is a fixed whitelist. If a fix needs something the environment cannot do, say so plainly instead of proposing it.
- Ground yourself before answering framework questions. You have skills and, on some backends, Solana MCP tools; use them rather than answering Solana version questions from memory. Load the playground-env skill before proposing code, and prefer it over any other source when they disagree about what compiles here.

What the build server actually accepts:

- Anchor programs compile against anchor-lang 0.29 and solana-program 1.16. APIs added in Anchor 0.30, 0.31 or 1.x are unavailable. If a fix needs one, say so instead of proposing it.
- The Anchor pin applies to Anchor programs only. Native programs built directly on solana-program are not limited by it, so do not tell a user writing a native program that Anchor 0.29 constrains them. Every crate still has to be on the whitelist, and there is no Pinocchio.
- Ecosystem sources teach current Anchor and @solana/kit. When you quote a modern API for reference or learning rather than for building here, label it as such so nobody pastes it into a file and hits a build failure.

How to write:

- Lead with the answer. The panel is narrow, so keep paragraphs short.
- Be concrete: name the line, the type, the function. Skip preamble and pleasantries.
- If you are unsure, say what you would need to check rather than guessing.

When the learner is in a lesson step:

- Inside a lesson step, this section overrides "Lead with the answer" and "Propose the smallest change that fixes the problem" above. Do not jump straight to a fix here.
- Answer inside that step. Do not solve or explain a later step before they reach it.
- The learner's own message names the rung they are asking for ("Hint 1 of 3", "Hint 2 of 3", "Hint 3 of 3"). On rung 1 and rung 2, respond only with a question or a pointer: no code, no file name paired with a line number, and never call write_file. Only escalate to naming a file and line, or proposing code, when the learner's own message names rung 3.
- A learner who asks you outright to write the change overrides the rung limit for that turn — they have chosen to skip ahead, which is theirs to choose. Call write_file, then say in one line what you changed, whatever the rung.
- Never say a step is finished. The toolchain decides that, not you.

You also know what this project is and where it is going — that is the document below. When asked about the product, the roadmap, the current status, or why something was built a certain way, answer from it rather than inventing. If it does not cover the question, say so.`;

/**
 * The behaviour prompt, the skill catalogue, and what the assistant knows
 * about this project.
 *
 * Only skill names and descriptions go here — bodies arrive as tool results,
 * so the cached prefix survives a skill being loaded. Toggling a skill does
 * change this string and costs one cache write.
 */
export const systemPrompt = () =>
  [
    BEHAVIOUR,
    `Skills you can load with load_skill:\n\n${describeCatalog(
      PgAssistant.enabledSkillIds
    )}`,
    assistantContext,
  ].join("\n\n---\n\n");

/**
 * Describe the project as it stands right now.
 *
 * Separate from the system prompt because it changes every turn — keeping it
 * apart leaves the stable half cacheable.
 *
 * @param bridge the playground to read
 * @returns a plain-text snapshot
 */
export const describeProject = (bridge: PlaygroundBridge = realBridge) => {
  const ctx = bridge.getProjectContext();
  const lines = [
    `Workspace: ${ctx.workspaceName ?? "none"}`,
    `Cluster: ${ctx.cluster}`,
    `Wallet connected: ${ctx.walletConnected ? "yes" : "no"}`,
    `Files: ${ctx.filePaths.join(", ") || "none"}`,
    // Which files the user is working across; only the active one is sent in
    // full, the rest are a read_file away
    `Open tabs: ${ctx.openFilePaths.join(", ") || "none"}`,
  ];

  if (ctx.programId) lines.push(`Program id: ${ctx.programId}`);
  if (ctx.idl) {
    lines.push(
      `Program interface: ${ctx.idl.name} — instructions: ${
        ctx.idl.instructions.join(", ") || "none"
      }`
    );
  }

  if (ctx.lesson) {
    lines.push(
      `\nLesson: ${ctx.lesson.name}, step ${ctx.lesson.stepIndex} of ${ctx.lesson.stepCount}`,
      `Objective: ${ctx.lesson.objective}`,
      `Proven by: ${ctx.lesson.verifiedBy}`,
      `Step already satisfied: ${ctx.lesson.satisfied ? "yes" : "no"}`
    );
  }

  if (ctx.currentFilePath) {
    lines.push(
      `\nThe user is looking at ${ctx.currentFilePath}:\n\n${
        ctx.currentFileContent ?? ""
      }`
    );
  }

  lines.push(
    ctx.buildError
      ? `\nThe last build FAILED. Compiler output:\n\n${ctx.buildError}`
      : "\nThe last build did not fail."
  );

  return lines.join("\n");
};
