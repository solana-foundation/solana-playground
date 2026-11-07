import type { Stage } from "@/views/flow/state/stage";

import type { NetworkInput } from "./indicators";
import { networkIndicator, OFFLINE_LINE } from "./indicators";

/**
 * What keeps work waiting: the browser is offline (Spec 08 NET-01) or the
 * cluster does not answer (NET-02). It does not depend on the stage;
 * `stageNotice` decides where it shows. Offline comes first: a cluster cannot
 * answer a browser with no network.
 */
export type NoticeCondition = "offline" | "cluster-down";

/** The line over the stage, when the stage shows one */
export interface StageNoticeView {
  kind: NoticeCondition;
  text: string;
}

/** The stages that wait for the cluster; Write and Build do not */
const WAITS_FOR_CLUSTER: ReadonlySet<Stage> = new Set(["deploy", "interact"]);

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The condition. Whether the cluster is down is read through
 * `networkIndicator`, so the indicator and the notice cannot disagree on it.
 */
export const noticeCondition = (
  network: NetworkInput,
  online: boolean
): NoticeCondition | undefined => {
  if (!online) return "offline";
  return networkIndicator(network, online).state === "not-ready"
    ? "cluster-down"
    : undefined;
};

/** The line `stage` shows for `condition`, or undefined when it shows none */
export const stageNotice = (
  condition: NoticeCondition | undefined,
  name: string,
  stage: Stage
): StageNoticeView | undefined => {
  if (condition === "offline") return { kind: "offline", text: OFFLINE_LINE };
  if (condition === "cluster-down" && WAITS_FOR_CLUSTER.has(stage)) {
    return {
      kind: "cluster-down",
      text: `${capitalize(
        name
      )} is not responding. Try again, or change the network.`,
    };
  }
  return undefined;
};

/**
 * Why Deploy and Interact's action is held, if it is. The notice's condition,
 * whatever the stage, so the status and the buttons cannot disagree.
 */
export const networkHold = (
  network: NetworkInput,
  online: boolean
): string | undefined => {
  switch (noticeCondition(network, online)) {
    case "offline":
      return "You're offline";
    case "cluster-down":
      return `${capitalize(network.name)} is not responding`;
    default:
      return undefined;
  }
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("widgets/status/model/notice", () => {
    const UP: NetworkInput = {
      name: "devnet",
      isConnected: true,
      slotStalled: false,
    };
    const DOWN: NetworkInput = {
      name: "devnet",
      isConnected: false,
      slotStalled: null,
    };
    const STALLED: NetworkInput = {
      name: "devnet",
      isConnected: true,
      slotStalled: true,
    };
    const CONNECTING: NetworkInput = {
      name: "devnet",
      isConnected: null,
      slotStalled: null,
    };

    it("reads offline before anything the cluster says", () => {
      expect(noticeCondition(DOWN, false)).toBe("offline");
      expect(noticeCondition(UP, false)).toBe("offline");
    });

    it("reads a cluster that does not answer, or whose slot stalls, as down", () => {
      expect(noticeCondition(DOWN, true)).toBe("cluster-down");
      expect(noticeCondition(STALLED, true)).toBe("cluster-down");
    });

    it("has nothing to say while the cluster answers or still connects", () => {
      expect(noticeCondition(UP, true)).toBeUndefined();
      expect(noticeCondition(CONNECTING, true)).toBeUndefined();
    });

    it("shows the offline line on every stage", () => {
      const stages: Stage[] = ["write", "build", "deploy", "interact"];
      expect(
        stages.map((stage) => stageNotice("offline", "devnet", stage))
      ).toEqual(stages.map(() => ({ kind: "offline", text: OFFLINE_LINE })));
    });

    it("shows the cluster line on Deploy and Interact only", () => {
      expect(stageNotice("cluster-down", "devnet", "deploy")).toEqual({
        kind: "cluster-down",
        text: "Devnet is not responding. Try again, or change the network.",
      });
      expect(stageNotice("cluster-down", "testnet", "interact")?.text).toBe(
        "Testnet is not responding. Try again, or change the network."
      );
      expect(stageNotice("cluster-down", "devnet", "write")).toBeUndefined();
      expect(stageNotice("cluster-down", "devnet", "build")).toBeUndefined();
    });

    it("shows nothing with nothing wrong", () => {
      expect(stageNotice(undefined, "devnet", "deploy")).toBeUndefined();
    });

    it("gives Deploy and Interact the reason they wait, if any", () => {
      expect(networkHold(DOWN, false)).toBe("You're offline");
      expect(networkHold(DOWN, true)).toBe("Devnet is not responding");
      expect(networkHold(STALLED, true)).toBe("Devnet is not responding");
      expect(networkHold(UP, true)).toBeUndefined();
      expect(networkHold(CONNECTING, true)).toBeUndefined();
    });
  });
}
