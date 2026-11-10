import type { AnalyzerState } from "@/components/Editor/Monaco/languages/rust/rust-analyzer/status";
import { clusterName } from "@/entities/cluster";

/**
 * One indicator's state. `not-ready` waits on something outside it (offline,
 * a cluster that does not answer, a start that takes longer, the hosted
 * model's free daily limit) and draws the warning colour the offline notice
 * has; `failed` is broken (the analyzer threw, or the deployment did not
 * answer whether it serves a hosted model) and is the only red. `idle` is
 * neither ready nor not ready (the analyzer before a Rust file, or where the
 * browser cannot run it; the AI with no model connected, which is the user's
 * choice and not a failure): grey, and left out of the phone chip's count.
 */
export type StatusState = "ready" | "working" | "not-ready" | "failed" | "idle";

export type IndicatorId = "network" | "ai" | "rust";

/** What fixes an indicator, from its panel or its sheet row */
export type StatusAction =
  | { kind: "network"; text: "Change network" }
  | { kind: "ai"; text: "Connect a model" | "Change model" | "Add an API key" }
  | { kind: "reload"; text: "Reload" };

/** Everything a view needs to draw one indicator, in any of its places */
export interface StatusIndicator {
  id: IndicatorId;
  /** The sheet row's title */
  name: string;
  state: StatusState;
  /** What the indicator reads: "Devnet · Not responding" */
  words: string;
  /** The button's accessible name in the status row */
  label: string;
  /** The rail dot's name, where it differs from `label` */
  railLabel: string;
  /** The rail dot's tooltip: the indicator and its state in the row's words,
   * with the state said even where the row leaves it out ("Devnet · Ready"),
   * because the rail shows no words beside its dot */
  tip: string;
  /** What the live region says, where `label` names an action rather than
   * the state: "Devnet, not responding"; `label` otherwise */
  announced?: string;
  /** What it means when not ready, for the panel and the sheet; undefined when
   * there is nothing to add to the words */
  detail: string | undefined;
  action: StatusAction | undefined;
  /** The panel a press opens with `detail` and the buttons; without one a
   * press goes straight to `action`. Only where the panel adds something:
   * the analyzer, a cluster that does not answer, the AI's limit and failure.
   * `retry`: whether the panel and the sheet row offer "Try again" before
   * `action`, which is why it lives here and not beside it */
  panel: IndicatorPanel | undefined;
}

/** What an indicator's panel holds beyond its line and action */
export interface IndicatorPanel {
  retry: boolean;
}

/** The phone chip: the worst state of the three, in words; one that failed
 * outranks one that waits */
export interface ChipView {
  state: Exclude<StatusState, "idle">;
  words: string;
  label: string;
}

/** After this long, a start that has not answered reads "Taking longer" */
export const SLOW_AFTER_MS = 60_000;

/** The offline line, on the indicators and over the stage alike: one cause, one message */
export const OFFLINE_LINE =
  "You're offline. Editing still works. Build, Deploy and the assistant need a connection.";

export interface NetworkInput {
  /** The cluster's name as the connection has it: "devnet" */
  name: string;
  /** `PgConnection.isConnected`: null or undefined until it first answers */
  isConnected: boolean | null | undefined;
  /** `PgConnection.isClusterDown`: answering with a slot that does not move */
  slotStalled: boolean | null | undefined;
}

export type AiInput =
  | { kind: "ready"; model: string }
  /** Nothing connected, and asking the deployment for its hosted model failed */
  | { kind: "unreachable" }
  /** The hosted model refused a turn under its free daily limit; `until` is
   * when it comes back, as a time */
  | { kind: "limit"; until: number }
  /** The hosted model refused a turn because its tier's pool is spent; only
   * the upstream knows when it refills, so no time is named */
  | { kind: "out-of-capacity" }
  /** `needsSignIn`: the default backend while nobody is signed in */
  | { kind: "off"; needsSignIn: boolean };

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A cluster's name as the network chips show it: "Mainnet" for `mainnet-beta` */
export const shownClusterName = (name: string) => capitalize(clusterName(name));

const NETWORK_ACTION: StatusAction = {
  kind: "network",
  text: "Change network",
};

export const networkIndicator = (
  { name, isConnected, slotStalled }: NetworkInput,
  online: boolean
): StatusIndicator => {
  const shown = shownClusterName(name);
  const view = (
    state: StatusState,
    suffix: string | undefined,
    detail: string | undefined
  ): StatusIndicator => {
    // Only a state that is not ready joins the name: "connecting" is every
    // first load, and the settings' focus return and its tests look the
    // trigger up by its plain name meanwhile
    const spoken = suffix && state === "not-ready" ? `, ${suffix}` : "";
    // Only ready and an unstarted Playnet come without a suffix
    const tipWord = suffix ?? (state === "idle" ? "not started" : "ready");
    // Asking again only helps a cluster that is reached and does not answer:
    // offline, the line already says what it waits for
    const down = state === "not-ready" && online;
    return {
      id: "network",
      name: "Network",
      state,
      words: suffix ? `${shown} · ${capitalize(suffix)}` : shown,
      // The names the settings' focus return and its tests look up; the rail's
      // dot keeps its own shorter one
      label: `Change cluster, currently ${name}${spoken}`,
      railLabel: `Cluster: ${name}${spoken}`,
      tip: `${shown} · ${capitalize(tipWord)}`,
      announced: `${shown}${spoken}`,
      detail,
      action: NETWORK_ACTION,
      panel: down ? { retry: true } : undefined,
    };
  };

  if (!online) return view("not-ready", "offline", OFFLINE_LINE);
  // The same reading as the account menu's warning (`clusterIsDown` in
  // `widgets/session-footer`)
  if (isConnected === false || slotStalled === true) {
    return view(
      "not-ready",
      "not responding",
      "The cluster is not responding. Write and Build work; Deploy and Interact wait for it."
    );
  }
  // Playnet is not asked until it has started (`PgConnection.getIsConnected`),
  // so its `null` can last: grey, not a pulse that never ends
  if (isConnected == null && name === "playnet") {
    return view("idle", undefined, "Playnet starts when a command needs it.");
  }
  if (isConnected == null) return view("working", "connecting", undefined);
  return view("ready", undefined, undefined);
};

/** "05:00", in the user's own clock */
const clockTime = (at: number) =>
  new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

const ADD_KEY: StatusAction = { kind: "ai", text: "Add an API key" };

export const aiIndicator = (ai: AiInput, online: boolean): StatusIndicator => {
  const base = {
    id: "ai" as const,
    name: "AI",
    panel: undefined,
  };
  if (!online) {
    return {
      ...base,
      state: "not-ready",
      words: "AI · Offline",
      label: "AI, offline",
      railLabel: "AI, offline",
      tip: "AI · Offline",
      detail: OFFLINE_LINE,
      action: undefined,
    };
  }
  if (ai.kind === "ready") {
    return {
      ...base,
      state: "ready",
      words: ai.model,
      // Not the model's name: the composer's model button is found by it,
      // and a second button holding it would make that lookup ambiguous
      label: "AI, ready",
      railLabel: "AI, ready",
      tip: `AI · Ready (${ai.model})`,
      detail: undefined,
      action: { kind: "ai", text: "Change model" },
    };
  }
  if (ai.kind === "limit") {
    // Waiting, not broken: it comes back by itself at `until`
    return {
      ...base,
      state: "not-ready",
      words: "AI · Limit reached",
      label: "AI, limit reached",
      railLabel: "AI, limit reached",
      tip: "AI · Limit reached",
      detail: `The free daily limit is used. It comes back at ${clockTime(
        ai.until
      )}, or add a key of your own to keep going.`,
      action: ADD_KEY,
      panel: { retry: false },
    };
  }
  if (ai.kind === "out-of-capacity") {
    // Waiting too, with the chat's own sentence: no time to promise
    return {
      ...base,
      state: "not-ready",
      words: "AI · Limit reached",
      label: "AI, limit reached",
      railLabel: "AI, limit reached",
      tip: "AI · Limit reached",
      detail:
        "The free assistant is out of capacity for now. Try again later, or add a key of your own to keep going.",
      action: ADD_KEY,
      panel: { retry: false },
    };
  }
  if (ai.kind === "unreachable") {
    // A failure that would otherwise hide as "Off"
    return {
      ...base,
      state: "failed",
      words: "AI · Not responding",
      label: "AI, not responding",
      railLabel: "AI, not responding",
      tip: "AI · Not responding",
      detail:
        "The hosted model is not responding. Try again, or add a key of your own.",
      action: ADD_KEY,
      panel: { retry: true },
    };
  }
  // No model is the user's choice, not a failure: grey like the analyzer's
  // Off, and not counted by the phone chip. Red stays for what is broken.
  return {
    ...base,
    state: "idle",
    words: "AI · Off",
    label: "AI, off",
    railLabel: "AI, off",
    tip: "AI · Off",
    detail: ai.needsSignIn
      ? "Sign in with GitHub to use the hosted model, or add a key of your own."
      : "Connect a model to ask the assistant. Write and Build work without it.",
    action: { kind: "ai", text: "Connect a model" },
  };
};

/** A run a reload of the page would throw away */
export type RunUnderWay = "build" | "deploy";

/** A reload would throw the run away, and a first build does not start again
 * (Spec 06 RUN-33), so an indicator offering one says when it comes back */
export const holdingReload = (
  indicator: StatusIndicator,
  run: RunUnderWay
): StatusIndicator =>
  indicator.action?.kind === "reload"
    ? {
        ...indicator,
        detail: `${indicator.detail} Reload comes back when the ${run} ends.`,
        action: undefined,
      }
    : indicator;

const RELOAD: StatusAction = { kind: "reload", text: "Reload" };
const ANALYZER_WAITING =
  "Code builds as normal. Hints and errors in the editor return when it is ready.";

export const analyzerIndicator = (
  analyzer: AnalyzerState,
  now: number,
  online: boolean
): StatusIndicator => {
  const view = (
    state: StatusState,
    word: string | undefined,
    spoken: string,
    detail: string | undefined,
    action: StatusAction | undefined
  ): StatusIndicator => ({
    id: "rust",
    name: "Rust analyzer",
    state,
    words: word ? `Rust · ${word}` : "Rust",
    label: `Rust analyzer, ${spoken}`,
    railLabel: `Rust analyzer, ${spoken}`,
    // Only the analyzer that has not started comes without a word
    tip: `Rust · ${word ?? "Not started"}`,
    detail,
    action,
    // The analyzer has no settings to go to: its panel is where it is explained
    panel: { retry: false },
  });

  // Offline reads the same on all three (Spec 06, "Offline"); a reload would
  // not get far
  if (!online) {
    return view("not-ready", "Offline", "offline", OFFLINE_LINE, undefined);
  }
  switch (analyzer.kind) {
    case "idle":
      return view(
        "idle",
        undefined,
        "not started",
        "It starts when you open a Rust file.",
        undefined
      );
    case "off":
      return view(
        "idle",
        "Off",
        "off",
        "This browser cannot run it on this page. Code builds as normal.",
        undefined
      );
    case "ready":
      return view(
        "ready",
        "Ready",
        "ready",
        "Hints and errors show in the editor as you type.",
        undefined
      );
    case "failed":
      return view(
        "failed",
        "Failed",
        "failed",
        "Code builds as normal. Hints and errors in the editor are off until it restarts.",
        RELOAD
      );
    case "starting": {
      const elapsed = Math.max(0, now - analyzer.since);
      if (elapsed >= SLOW_AFTER_MS) {
        return view(
          "not-ready",
          "Taking longer",
          "taking longer than usual",
          ANALYZER_WAITING,
          RELOAD
        );
      }
      const seconds = Math.floor(elapsed / 1000);
      // No Reload yet: a slow download is normal in its first minute, and a
      // reload would throw away a build or a deploy under way
      return view(
        "working",
        `Starting ${seconds} s`,
        `starting, ${seconds} seconds`,
        ANALYZER_WAITING,
        undefined
      );
    }
  }
};

/**
 * The phone chip: "Offline" (Spec 08 NET-01: one cause, not "3 not ready"),
 * "Ready", "Starting" or "<n> not ready"
 */
export const chipOf = (
  indicators: readonly StatusIndicator[],
  online: boolean
): ChipView => {
  if (!online) {
    return { state: "not-ready", words: "Offline", label: "Status, offline" };
  }
  const down = indicators.filter(
    (i) => i.state === "not-ready" || i.state === "failed"
  ).length;
  if (down > 0) {
    const words = `${down} not ready`;
    const state = indicators.some((i) => i.state === "failed")
      ? "failed"
      : "not-ready";
    return { state, words, label: `Status, ${words}` };
  }
  if (indicators.some((i) => i.state === "working")) {
    return { state: "working", words: "Starting", label: "Status, starting" };
  }
  return { state: "ready", words: "Ready", label: "Status, ready" };
};

if (import.meta.vitest) {
  const { describe, it, expect, expectTypeOf } = import.meta.vitest;

  describe("widgets/status/model/indicators", () => {
    const UP: NetworkInput = {
      name: "devnet",
      isConnected: true,
      slotStalled: false,
    };

    describe("networkIndicator", () => {
      it("names the cluster when it answers, under the settings trigger's name", () => {
        const n = networkIndicator(UP, true);
        expect([n.state, n.words, n.label, n.railLabel, n.tip]).toEqual([
          "ready",
          "Devnet",
          "Change cluster, currently devnet",
          "Cluster: devnet",
          "Devnet · Ready",
        ]);
      });

      // HOO-2488: the chips' name, never "Mainnet-beta"; the settings
      // trigger's names keep the moniker its lookups use
      it("shows mainnet-beta as Mainnet", () => {
        const n = networkIndicator(
          { name: "mainnet-beta", isConnected: true, slotStalled: false },
          true
        );
        expect([n.words, n.tip, n.label]).toEqual([
          "Mainnet",
          "Mainnet · Ready",
          "Change cluster, currently mainnet-beta",
        ]);
      });

      it("is connecting until the connection first answers", () => {
        const n = networkIndicator(
          { name: "devnet", isConnected: null, slotStalled: null },
          true
        );
        expect([n.state, n.words, n.label, n.tip]).toEqual([
          "working",
          "Devnet · Connecting",
          "Change cluster, currently devnet",
          "Devnet · Connecting",
        ]);
      });

      it("keeps a Playnet that has not started grey and plain", () => {
        const n = networkIndicator(
          { name: "playnet", isConnected: null, slotStalled: null },
          true
        );
        expect([n.state, n.words, n.label, n.tip]).toEqual([
          "idle",
          "Playnet",
          "Change cluster, currently playnet",
          "Playnet · Not started",
        ]);
      });

      it("says not responding when down, or when the slot stalls", () => {
        const down = networkIndicator(
          { name: "devnet", isConnected: false, slotStalled: null },
          true
        );
        const stalled = networkIndicator(
          { name: "devnet", isConnected: true, slotStalled: true },
          true
        );
        expect([down.state, down.words, down.label]).toEqual([
          "not-ready",
          "Devnet · Not responding",
          "Change cluster, currently devnet, not responding",
        ]);
        expect(stalled.words).toBe("Devnet · Not responding");
        expect(down.tip).toBe("Devnet · Not responding");
        expect(down.action).toEqual({
          kind: "network",
          text: "Change network",
        });
      });

      it("announces the network by name and state", () => {
        const n = networkIndicator(
          { name: "devnet", isConnected: false, slotStalled: undefined },
          true
        );
        expect(n.announced).toBe("Devnet, not responding");
      });

      it("opens a panel with Try again only while the cluster does not answer", () => {
        const down = networkIndicator(
          { name: "devnet", isConnected: false, slotStalled: undefined },
          true
        );
        const connecting = networkIndicator(
          { name: "devnet", isConnected: undefined, slotStalled: undefined },
          true
        );
        const offline = networkIndicator(UP, false);
        const views = [down, networkIndicator(UP, true), connecting, offline];
        expect(views.map((n) => n.panel)).toEqual([
          { retry: true },
          undefined,
          undefined,
          // Asking again goes nowhere offline; the line says why it waits
          undefined,
        ]);
      });

      it("says offline over any other state", () => {
        const n = networkIndicator(UP, false);
        expect([n.state, n.words, n.detail]).toEqual([
          "not-ready",
          "Devnet · Offline",
          OFFLINE_LINE,
        ]);
      });
    });

    describe("aiIndicator", () => {
      it("names the model when one is connected", () => {
        const a = aiIndicator({ kind: "ready", model: "Opus 5.5" }, true);
        expect([a.state, a.words, a.label, a.tip]).toEqual([
          "ready",
          "Opus 5.5",
          "AI, ready",
          "AI · Ready (Opus 5.5)",
        ]);
      });

      it("reads Off, grey, with Connect a model when none is", () => {
        const a = aiIndicator({ kind: "off", needsSignIn: false }, true);
        expect([a.state, a.words, a.label, a.tip, a.action]).toEqual([
          "idle",
          "AI · Off",
          "AI, off",
          "AI · Off",
          { kind: "ai", text: "Connect a model" },
        ]);
      });

      it("says sign-in is the way to the hosted model", () => {
        const a = aiIndicator({ kind: "off", needsSignIn: true }, true);
        expect(a.detail).toBe(
          "Sign in with GitHub to use the hosted model, or add a key of your own."
        );
      });

      it("reads Limit reached, waiting, with a panel saying when it comes back", () => {
        // 05:00 in the zone the test runs in, whatever that zone is
        const until = new Date(2026, 10, 5, 5, 0).getTime();
        const a = aiIndicator({ kind: "limit", until }, true);
        expect([a.state, a.words, a.label, a.tip, a.panel, a.action]).toEqual([
          "not-ready",
          "AI · Limit reached",
          "AI, limit reached",
          "AI · Limit reached",
          { retry: false },
          { kind: "ai", text: "Add an API key" },
        ]);
        expect(a.detail).toBe(
          "The free daily limit is used. It comes back at 05:00, or add a key of your own to keep going."
        );
      });

      it("reads Limit reached after a spent pool, with a panel naming no time", () => {
        const a = aiIndicator({ kind: "out-of-capacity" }, true);
        expect([a.state, a.words, a.label, a.panel, a.action]).toEqual([
          "not-ready",
          "AI · Limit reached",
          "AI, limit reached",
          { retry: false },
          { kind: "ai", text: "Add an API key" },
        ]);
        expect(a.detail).toBe(
          "The free assistant is out of capacity for now. Try again later, or add a key of your own to keep going."
        );
      });

      it("reads Not responding, failed, with Try again when the check fails", () => {
        const a = aiIndicator({ kind: "unreachable" }, true);
        expect([a.state, a.words, a.label, a.panel, a.action]).toEqual([
          "failed",
          "AI · Not responding",
          "AI, not responding",
          { retry: true },
          { kind: "ai", text: "Add an API key" },
        ]);
      });

      it("opens no panel when ready or off", () => {
        const ready = aiIndicator({ kind: "ready", model: "Opus 5.5" }, true);
        const off = aiIndicator({ kind: "off", needsSignIn: false }, true);
        expect([ready.panel, off.panel]).toEqual([undefined, undefined]);
      });

      it("reads Offline offline", () => {
        const a = aiIndicator({ kind: "ready", model: "Opus 5.5" }, false);
        expect([a.state, a.words, a.tip]).toEqual([
          "not-ready",
          "AI · Offline",
          "AI · Offline",
        ]);
      });
    });

    describe("analyzerIndicator", () => {
      it("counts the seconds of a start", () => {
        const r = analyzerIndicator(
          { kind: "starting", since: 1_000 },
          13_500,
          true
        );
        expect([r.state, r.words, r.label, r.action]).toEqual([
          "working",
          "Rust · Starting 12 s",
          "Rust analyzer, starting, 12 seconds",
          undefined,
        ]);
      });

      it("takes longer than usual from 60 s", () => {
        const r = analyzerIndicator(
          { kind: "starting", since: 0 },
          SLOW_AFTER_MS,
          true
        );
        expect([r.state, r.words, r.label, r.action?.text]).toEqual([
          "not-ready",
          "Rust · Taking longer",
          "Rust analyzer, taking longer than usual",
          "Reload",
        ]);
      });

      it("still starts a moment before 60 s", () => {
        const r = analyzerIndicator(
          { kind: "starting", since: 0 },
          SLOW_AFTER_MS - 1,
          true
        );
        expect(r.words).toBe("Rust · Starting 59 s");
      });

      it("reads ready, failed, off and not started in words", () => {
        const words = (["ready", "failed", "off", "idle"] as const).map(
          (kind) => {
            const r = analyzerIndicator({ kind }, 0, true);
            return [r.state, r.words, r.tip];
          }
        );
        expect(words).toEqual([
          ["ready", "Rust · Ready", "Rust · Ready"],
          ["failed", "Rust · Failed", "Rust · Failed"],
          ["idle", "Rust · Off", "Rust · Off"],
          ["idle", "Rust", "Rust · Not started"],
        ]);
      });

      it("keeps Reload away from a build or a deploy under way, and says so", () => {
        const slow = { kind: "starting", since: 0 } as const;
        const building = holdingReload(
          analyzerIndicator(slow, SLOW_AFTER_MS, true),
          "build"
        );
        expect(building.words).toBe("Rust · Taking longer");
        expect(building.action).toBeUndefined();
        expect(building.detail).toContain(
          "Reload comes back when the build ends."
        );
        const failed = holdingReload(
          analyzerIndicator({ kind: "failed" }, 0, true),
          "deploy"
        );
        expect(failed.action).toBeUndefined();
        expect(failed.detail).toContain(
          "Reload comes back when the deploy ends."
        );
      });

      it("reads Offline offline, with nothing to press", () => {
        const r = analyzerIndicator({ kind: "ready" }, 0, false);
        expect([r.state, r.words, r.action]).toEqual([
          "not-ready",
          "Rust · Offline",
          undefined,
        ]);
      });
    });

    describe("StatusIndicator", () => {
      it("offers Try again only inside a panel", () => {
        // A retry is a field of the panel, so an indicator cannot offer one
        // without a panel to hold it
        expectTypeOf<StatusIndicator>().not.toHaveProperty("retry");
        expectTypeOf<StatusIndicator["panel"]>().toEqualTypeOf<
          { retry: boolean } | undefined
        >();
      });
    });

    describe("chipOf", () => {
      const ready = networkIndicator(UP, true);
      const ai = aiIndicator({ kind: "ready", model: "Opus 5.5" }, true);
      const idle = analyzerIndicator({ kind: "idle" }, 0, true);

      it("is Ready when nothing is down or starting, idle aside", () => {
        expect(chipOf([ready, ai, idle], true).words).toBe("Ready");
      });

      it("is Ready with only the AI off: no model is a choice, not a failure", () => {
        const off = aiIndicator({ kind: "off", needsSignIn: true }, true);
        expect(chipOf([ready, off, idle], true)).toEqual({
          state: "ready",
          words: "Ready",
          label: "Status, ready",
        });
      });

      it("is Starting when one works and none is down", () => {
        const starting = analyzerIndicator(
          { kind: "starting", since: 0 },
          0,
          true
        );
        expect(chipOf([ready, ai, starting], true)).toEqual({
          state: "working",
          words: "Starting",
          label: "Status, starting",
        });
      });

      it("reads Offline offline, whatever the count", () => {
        const offline = [
          networkIndicator(UP, false),
          aiIndicator({ kind: "ready", model: "Opus 5.5" }, false),
          analyzerIndicator({ kind: "ready" }, 0, false),
        ];
        expect(chipOf(offline, false)).toEqual({
          state: "not-ready",
          words: "Offline",
          label: "Status, offline",
        });
      });

      it("counts the AI at its limit as not ready and not responding as failed", () => {
        const limit = aiIndicator(
          { kind: "limit", until: Date.UTC(2026, 10, 5) },
          true
        );
        expect(chipOf([ready, limit, idle], true)).toEqual({
          state: "not-ready",
          words: "1 not ready",
          label: "Status, 1 not ready",
        });
        const unreachable = aiIndicator({ kind: "unreachable" }, true);
        expect(chipOf([ready, unreachable, idle], true)).toEqual({
          state: "failed",
          words: "1 not ready",
          label: "Status, 1 not ready",
        });
      });

      it("counts what is not ready, the AI off aside, red once one failed", () => {
        const down = networkIndicator(
          { name: "devnet", isConnected: false, slotStalled: null },
          true
        );
        const off = aiIndicator({ kind: "off", needsSignIn: false }, true);
        const failed = analyzerIndicator({ kind: "failed" }, 0, true);
        expect(chipOf([down, off, failed], true)).toEqual({
          state: "failed",
          words: "2 not ready",
          label: "Status, 2 not ready",
        });
        expect(chipOf([down, off, idle], true)).toEqual({
          state: "not-ready",
          words: "1 not ready",
          label: "Status, 1 not ready",
        });
      });
    });
  });
}
