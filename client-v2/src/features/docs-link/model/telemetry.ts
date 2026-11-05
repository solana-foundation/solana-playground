import { createTracker } from "@/shared/lib/telemetry";

import type { DocsLinkFailure } from "../lib/link";

/** Whether a docs link opened the project that ran, or anything else did */
export type RunSource = "link" | "project";

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
   * A `run` started, from the stage row's Run or typed in the terminal;
   * `source` says whether a docs link opened the project
   */
  docs_link_run_started: { source: RunSource };
  /** That `run` ended; `seconds` is its whole seconds */
  docs_link_run_finished: {
    source: RunSource;
    outcome: RunOutcome;
    seconds: number;
  };
  /**
   * Run stopped at "Not enough SOL on devnet"; `wallet` is `new` when Run
   * had to set the wallet up first
   */
  docs_link_run_funding_shown: { wallet: WalletOrigin };
};

export const docsLinkTelemetry = createTracker<DocsLinkEvents>();
