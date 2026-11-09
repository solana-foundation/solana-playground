import { createTracker } from "@/shared/lib/telemetry";

/** What the built program is written with: Seahorse is Python, Native any Rust program that is not Anchor */
export type BuildFramework = "anchor" | "native" | "seahorse";

/**
 * Why a build did not succeed: the compiler (Seahorse's included) reported
 * an error, the build server did not answer, or it refused the request or
 * the build could not run
 */
export type BuildFailedReason = "compile" | "network" | "server";

type BuildEvents = {
  /** A build's files are about to go to the build server, whoever started it: the Build stage, the terminal, the assistant or a tutorial. A stopped build ends with no outcome event; an empty program file, never sent, sends nothing. */
  build_started: { framework: BuildFramework };
  /** The compiler reported no error; `has_idl` says whether the server returned an IDL. */
  build_succeeded: { framework: BuildFramework; has_idl: boolean };
  /** The build did not succeed, for `reason`. Never the compiler output. */
  build_failed: { framework: BuildFramework; reason: BuildFailedReason };
};

export const buildTelemetry = createTracker<BuildEvents>();
