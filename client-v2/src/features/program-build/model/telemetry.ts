import { createTracker } from "@/shared/lib/telemetry";

/** What the built program is written with: Seahorse is Python, Native any Rust program that is not Anchor */
export type BuildFramework = "anchor" | "native" | "seahorse";

/**
 * Why a build did not succeed: the compiler (Seahorse's included) reported
 * an error, the build server did not answer, the service was busy and named
 * a wait (a `429` or `503` with `Retry-After`: a per-user build limit or a
 * full build queue), or anything else (the server refused the request, or
 * the build could not run)
 */
export type BuildFailedReason = "compile" | "network" | "busy" | "server";

type BuildEvents = {
  /** A build began, once its files are gathered (Seahorse compiles them here before they go to the build server), whoever started it: the Build stage, the terminal, the assistant or a tutorial. A stopped build ends with no outcome event; an empty program file, never sent, sends nothing. */
  build_started: { framework: BuildFramework };
  /** The compiler reported no error; `has_idl` says whether the server returned an IDL. */
  build_succeeded: { framework: BuildFramework; has_idl: boolean };
  /** The build did not succeed, for `reason`. Never the compiler output. */
  build_failed: { framework: BuildFramework; reason: BuildFailedReason };
};

export const buildTelemetry = createTracker<BuildEvents>();
