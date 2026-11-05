import { useEffect, useRef, useState } from "react";

import type { StatusIndicator } from "./indicators";
import type { StageNoticeView } from "./notice";

const isDown = (i: StatusIndicator) =>
  i.state === "not-ready" || i.state === "failed";

/** Whether the line over the stage says this already, as an alert of its own */
const isSaidByNotice = (
  i: StatusIndicator,
  notice: StageNoticeView | null | undefined
) =>
  notice?.kind === "offline" ||
  (notice?.kind === "cluster-down" && i.id === "network");

/**
 * What the live region says for a step from `before` to `after`, if anything
 * (Spec 06 RUN-40): each indicator whose words changed to a state that is not
 * ready. Words, not state: offline to not responding is news, and a counting
 * start never gets here.
 */
const announcement = ({
  before,
  after,
  notice,
}: {
  before: readonly StatusIndicator[];
  after: readonly StatusIndicator[];
  notice?: StageNoticeView | null;
}): string | undefined =>
  after
    .filter(
      (i) =>
        isDown(i) &&
        !isSaidByNotice(i, notice) &&
        before.find((b) => b.id === i.id)?.words !== i.words
    )
    .map((i) => i.announced ?? i.label)
    .join(". ") || undefined;

/** Whether an indicator stopped being down in this step */
const hasRecovered = (
  before: readonly StatusIndicator[],
  after: readonly StatusIndicator[]
) =>
  before.some(
    (b) => isDown(b) && !after.some((i) => i.id === b.id && isDown(i))
  );

/**
 * The live region's text. The first render is the baseline, so what is down
 * at that moment says nothing; a cluster found down once it has been asked is
 * news. A recovery empties it: a screen
 * reader reads a change of text, and the same words again would be no change.
 */
export const useAnnouncement = (
  indicators: readonly StatusIndicator[],
  notice: StageNoticeView | null | undefined
): string => {
  const [text, setText] = useState("");
  const before = useRef(indicators);
  useEffect(() => {
    const said = announcement({
      before: before.current,
      after: indicators,
      notice,
    });
    const back = hasRecovered(before.current, indicators);
    before.current = indicators;
    if (said) setText(said);
    else if (back) setText("");
  }, [indicators, notice]);
  return text;
};

if (import.meta.vitest) {
  const { beforeAll, describe, it, expect } = import.meta.vitest;

  const STARTING = {
    id: "rust",
    state: "working",
    words: "Rust · Starting 12 s",
  } as StatusIndicator;
  const FAILED = {
    id: "rust",
    state: "failed",
    words: "Rust · Failed",
    label: "Rust analyzer, failed",
  } as StatusIndicator;
  const READY = {
    id: "rust",
    state: "ready",
    words: "Rust · Ready",
  } as StatusIndicator;
  const DOWN = {
    id: "network",
    state: "not-ready",
    words: "Devnet · Not responding",
    label: "Change cluster, currently devnet, not responding",
    announced: "Devnet, not responding",
  } as StatusIndicator;
  const UP = {
    id: "network",
    state: "ready",
    words: "Devnet",
  } as StatusIndicator;
  const OFFLINE = { kind: "offline", text: "" } as const;
  const CLUSTER_DOWN = { kind: "cluster-down", text: "" } as const;

  describe("widgets/status/model/announce", () => {
    let analyzerIndicator: typeof import("./indicators").analyzerIndicator;
    let networkIndicator: typeof import("./indicators").networkIndicator;

    beforeAll(async () => {
      ({ analyzerIndicator, networkIndicator } = await import("./indicators"));
    });

    it("says the name and state of what stops being ready", () => {
      expect(announcement({ before: [STARTING], after: [FAILED] })).toBe(
        "Rust analyzer, failed"
      );
    });

    it("is silent from Working to Ready, and on a counting start", () => {
      expect(
        announcement({ before: [STARTING], after: [READY] })
      ).toBeUndefined();
      const later = {
        id: "rust",
        state: "working",
        words: "Rust · Starting 13 s",
      };
      expect(
        announcement({ before: [STARTING], after: [later as StatusIndicator] })
      ).toBeUndefined();
    });

    it("says it once, not again while it lasts", () => {
      expect(
        announcement({ before: [FAILED], after: [FAILED] })
      ).toBeUndefined();
    });

    it("speaks the real indicators' words", () => {
      const starting = analyzerIndicator(
        { kind: "starting", since: 0 },
        0,
        true
      );
      const failed = analyzerIndicator({ kind: "failed" }, 0, true);
      expect(announcement({ before: [starting], after: [failed] })).toBe(
        "Rust analyzer, failed"
      );
      const up = networkIndicator(
        { name: "devnet", isConnected: true, slotStalled: false },
        true
      );
      const down = networkIndicator(
        { name: "devnet", isConnected: false, slotStalled: undefined },
        true
      );
      expect(announcement({ before: [up], after: [down] })).toBe(
        "Devnet, not responding"
      );
    });

    it("says two at once in one line, the network by its own words", () => {
      expect(announcement({ before: [UP, READY], after: [DOWN, FAILED] })).toBe(
        "Devnet, not responding. Rust analyzer, failed"
      );
    });

    it("leaves out what the line over the stage says", () => {
      expect(
        announcement({ before: [UP], after: [DOWN], notice: OFFLINE })
      ).toBeUndefined();
      expect(
        announcement({ before: [READY], after: [FAILED], notice: OFFLINE })
      ).toBeUndefined();
      expect(
        announcement({ before: [UP], after: [DOWN], notice: CLUSTER_DOWN })
      ).toBeUndefined();
      expect(
        announcement({ before: [READY], after: [FAILED], notice: CLUSTER_DOWN })
      ).toBe("Rust analyzer, failed");
    });

    it("knows when something stops being down", () => {
      expect(hasRecovered([FAILED], [READY])).toBe(true);
      expect(hasRecovered([STARTING], [READY])).toBe(false);
      expect(hasRecovered([FAILED], [FAILED])).toBe(false);
    });
  });
}
