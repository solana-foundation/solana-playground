import { createTracker } from "@/shared/lib/telemetry";

import type { DocsLinkFailure } from "../lib/link";

/** Whether Run had to set the Playground wallet up before checking its SOL */
export type WalletOrigin = "new" | "existing";

/** How a run from the stage row ended */
export type RunOutcome = "done" | "failed" | "missing-package";

type DocsLinkEvents = {
  /**
   * A docs link decoded and its project opened. `host` is the host of the
   * link's `from`, or `none`; `bytes` is the decoded file's size.
   */
  docs_link_opened: { host: string; bytes: number };
  /** "This link is broken" showed; `reason` says what was wrong with it */
  docs_link_failed: { reason: DocsLinkFailure };
  /**
   * A `run` started in a project a docs link opened, from the stage row's
   * Run or typed in the terminal. A run anywhere else sends no
   * `docs_link_run_*` event: `run_finished` and `run_errored` (the `run`
   * slice's, sent by `commands/run-and-test`) count every run.
   * `via` stays for the reports that read it; it is always `link`.
   */
  docs_link_run_started: { via: "link" };
  /** That `run` ended; `seconds` is its whole seconds, `via` as above */
  docs_link_run_finished: {
    via: "link";
    outcome: RunOutcome;
    seconds: number;
  };
  /**
   * Run stopped at "Not enough SOL on devnet"; `funding_state` is `new` when
   * Run had to set the wallet up first
   */
  docs_link_run_funding_shown: { funding_state: WalletOrigin };
};

/**
 * Free text, opted in: no type lists the values, so the owner decides
 * whether to keep it (HOO-2752)
 */
type DocsLinkFreeText = {
  host: "the host of the page a docs link came from, which can be any site";
};

export const docsLinkTelemetry = createTracker<
  DocsLinkEvents,
  DocsLinkFreeText
>();
