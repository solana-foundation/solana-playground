/* eslint-disable layers/curry-order, max-params, unicorn/no-null -- tutorial flow v2 predates these rules; cleanup tracked from SF#94 */
import type { Act } from "@/entities/tutorial";
import { createLogger } from "@/shared/lib/logger";
import { PgCommand, PgExplorer, PgProgramInfo } from "@/utils";
import { isSignInRefusalError } from "@/utils/sign-in-refusal";
import {
  PgBuildOutput,
  stripKnownNoise,
} from "@/views/sidebar/assistant/bridge/build-output";

import { pickBuildError } from "../build-error";
import type { RunInput, RunStage } from "../ports";
import { failedResult } from "../ports";
import type { RunResult } from "../progress";

/**
 * What `fetch` says when no answer reached the browser, in Chrome, Firefox
 * and Safari. `PgServer` wraps it as "Server request failed (<url>): …"; a
 * server that answered with an error status carries its own text instead.
 */
const NO_ANSWER = /Failed to fetch|NetworkError|Load failed/;

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

const log = createLogger("tutorial-conversation:build");

/**
 * The build act: the editor's own Build, so the program's id, IDL and
 * last-build state move exactly as they do for the editor (design D4), then
 * the raw log the command keeps for the assistant, read back and parsed.
 * The result is a fact, never a throw: a server that never answered is
 * `unreachable`; one that asked for a sign-in is `signed_out`; one that
 * refused the request otherwise shows its text as the log, with no line.
 *
 * @param act the act being run; only `build` reaches this runner
 * @param input the step's `failsWith`, when the build may be its planned failure
 * @param onStage "Building", the act's one stage
 */
export const runBuild = async (
  act: Act,
  input: RunInput,
  onStage: (stage: RunStage) => void
): Promise<RunResult> => {
  onStage({ label: "Building", index: 1, count: 1 });
  const startedAt = Date.now();
  const workspace = PgExplorer.currentWorkspaceName ?? null;
  const seconds = () => (Date.now() - startedAt) / 1000;

  try {
    await PgCommand.build.execute();
  } catch (e) {
    const message = messageOf(e);
    if (NO_ANSWER.test(message)) {
      log.warn("the build server did not answer", { context: { message } });
      return failedResult(act, message, seconds());
    }
    // Nothing is wrong with the code: the card asks for a sign-in, and the
    // team has nothing to hear (HOO-2661)
    if (isSignInRefusalError(e)) {
      log.info("the build server asked for a sign-in");
      return {
        act: "build",
        ok: false,
        seconds: seconds(),
        reason: "signed_out",
        error: null,
        log: message,
      };
    }
    // A server refusal, or the client failing before the request: the card
    // shows the text as the log; the team hears of it
    log.error(e, { report: true, context: { act } });
    return {
      act: "build",
      ok: false,
      seconds: seconds(),
      reason: "compiler",
      error: null,
      log: message,
    };
  }

  // The output is kept for the whole session: one from before this press,
  // or another workspace's, says nothing about this build
  const output = PgBuildOutput.latest;
  if (!output || output.at < startedAt || output.workspace !== workspace) {
    log.warn("a build ended with no output of its own", {
      context: {
        output: output ? "stale" : "none",
        workspace: output?.workspace ?? null,
        expected: workspace,
      },
    });
    return failedResult(act, "The build server sent no output.", seconds());
  }
  if (output.failed) {
    const error = pickBuildError(output.stderr, input.failsWith);
    // A failed build is the lesson's business, not the team's: logged, not
    // reported
    log.info("the build failed in the compiler", {
      context: { code: error?.code ?? null, line: error?.line ?? null },
    });
    return {
      act: "build",
      ok: false,
      seconds: seconds(),
      reason: "compiler",
      error,
      log: stripKnownNoise(output.stderr),
    };
  }
  return {
    act: "build",
    ok: true,
    seconds: seconds(),
    instructions: PgProgramInfo.idl?.instructions.map((ix) => ix.name) ?? [],
  };
};
