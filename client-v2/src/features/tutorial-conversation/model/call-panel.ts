import { createLogger } from "@/shared/lib/logger";

import { createGeneratableInstruction } from "../../../utils/program-interaction/instruction";
import { PgTerminal } from "../../../utils/terminal";
import type { Disposable } from "../../../utils/types";
import type {
  CallPanelTab,
  CallView,
  CallViewInput,
  LastCall,
} from "./call-view";
import { callView } from "./call-view";
import type { DeployedIdl } from "./deployed-idl";
import { shapeOf } from "./deployed-idl";
import type { RunResult } from "./progress";
import { liveInstruction, running } from "./reducer";
import { fillRememberedWith } from "./runners/transactions";
import { PgConversation } from "./store";

const log = createLogger("tutorial-conversation:call-panel");

/** The IDL shape last viewed per tutorial, on this device, as the docked tree */
const SEEN_KEY = "tutorial-conversation.call-seen";

const readSeen = (): Record<string, string> => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "{}");
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, string>)
      : {};
  } catch (error) {
    // A broken or blocked store shows the dot again; nothing worse
    log.warn("could not read the seen IDLs", { context: { error } });
    return {};
  }
};

const writeSeen = (name: string, shape: string) => {
  try {
    localStorage.setItem(
      SEEN_KEY,
      JSON.stringify({ ...readSeen(), [name]: shape })
    );
  } catch (error) {
    log.warn("could not save the seen IDL", { context: { error } });
  }
};

/**
 * The panel as the learner left it, per tutorial, for a reload of this tab:
 * open or not, the tab, the picked chip and the typed fields (the spec's
 * "Reload in step 3"). The tab's own store, so nothing syncs and no other tab
 * or device sees it; the latest result stays in memory
 */
const KEPT_KEY = "tutorial-conversation.call-panel";

type KeptPanel = Pick<PanelState, "open" | "tab" | "picked" | "values">;

const readAllKept = (): Record<string, Partial<KeptPanel>> => {
  try {
    const parsed: unknown = JSON.parse(
      sessionStorage.getItem(KEPT_KEY) ?? "{}"
    );
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, Partial<KeptPanel>>)
      : {};
  } catch (error) {
    // A broken or blocked store opens the panel as on a first visit
    log.warn("could not read the kept Call panel", { context: { error } });
    return {};
  }
};

/** The kept fields of `name` that have the right type; the rest start fresh */
const readKept = (name: string): Partial<KeptPanel> => {
  const kept = readAllKept()[name];
  if (typeof kept !== "object" || kept === null) return {};
  const out: Partial<KeptPanel> = {};
  if (typeof kept.open === "boolean") out.open = kept.open;
  if (kept.tab === "form" || kept.tab === "idl") out.tab = kept.tab;
  if (typeof kept.picked === "string") out.picked = kept.picked;
  if (typeof kept.values === "object" && kept.values !== null) {
    out.values = kept.values;
  }
  return out;
};

const writeKept = (name: string, state: KeptPanel) => {
  try {
    sessionStorage.setItem(
      KEPT_KEY,
      JSON.stringify({ ...readAllKept(), [name]: state })
    );
  } catch (error) {
    log.warn("could not keep the Call panel", { context: { error } });
  }
};

interface PanelState {
  /** The tutorial this state belongs to: another one starts clean */
  tutorial: string | undefined;
  open: boolean;
  tab: CallPanelTab;
  picked: string | undefined;
  values: Record<string, Record<string, string>>;
  showNew: boolean;
  last: LastCall | undefined;
  calling: boolean;
}

const INITIAL: PanelState = {
  tutorial: undefined,
  open: false,
  tab: "form",
  picked: undefined,
  values: {},
  showNew: false,
  last: undefined,
  calling: false,
};

/**
 * Accounts neither the Test form's defaults nor earlier calls fill. The
 * learner cannot give one here, and a random one would fail on devnet and read
 * as their mistake
 */
const emptyAccountsOf =
  (remembered: Record<string, string>): CallViewInput["emptyAccounts"] =>
  (ix) => {
    try {
      return fillRememberedWith(remembered)(
        createGeneratableInstruction(ix).values.accounts
      )
        .filter(
          ({ generator }) => generator.type === "Custom" && !generator.value
        )
        .map((a) => a.name);
    } catch (error) {
      // Seeds of a kind the defaults do not read: no way to fill those either
      log.warn("could not read an instruction's accounts", {
        context: { error },
      });
      return ix.accounts.map((a) => a.name);
    }
  };

/** The call's log, as the terminal's history of runs keeps it */
const logLines = (instruction: string, result: RunResult): string[] => {
  const head = `$ test ${instruction}`;
  if (result.act !== "call") return [head];
  if (result.ok) return [head, ...(result.receipt?.log ?? [])];
  return [head, ...(result.log ? result.log.split("\n") : [result.message])];
};

/**
 * The Call panel's own state: open or not, the picked chip, the fields and
 * the latest result. All of it is for the visit; only what the engine keeps
 * (the deployed IDL, a step passed) outlives it. The workspace's button and
 * the win card's "Open Call" reach it from two widgets, so it lives here.
 */
export class PgCallPanel {
  private static _state: PanelState = INITIAL;
  private static _listeners = new Set<() => void>();

  static onDidChange(cb: () => void): Disposable {
    PgCallPanel._listeners.add(cb);
    return { dispose: () => PgCallPanel._listeners.delete(cb) };
  }

  private static _name() {
    return PgConversation.state.context?.definition.name;
  }

  /** The state for the open tutorial */
  private static _current(): PanelState {
    const tutorial = PgCallPanel._name();
    if (PgCallPanel._state.tutorial !== tutorial) {
      PgCallPanel._state = {
        ...INITIAL,
        tutorial,
        ...(tutorial ? readKept(tutorial) : {}),
      };
    }
    return PgCallPanel._state;
  }

  private static _set(next: Partial<PanelState>) {
    PgCallPanel._state = { ...PgCallPanel._current(), ...next };
    const { tutorial, open, tab, picked, values } = PgCallPanel._state;
    if (tutorial) writeKept(tutorial, { open, tab, picked, values });
    for (const cb of PgCallPanel._listeners) cb();
  }

  private static _deployed() {
    return PgConversation.state.engine.progress.deployed;
  }

  /** Whether the program is deployed: the Call button's condition */
  static get callable() {
    return PgCallPanel._deployed() !== undefined;
  }

  static get isOpen() {
    return PgCallPanel._current().open;
  }

  static get tab() {
    return PgCallPanel._current().tab;
  }

  /** The button's dot: an IDL the panel has not shown on this device */
  static get dot() {
    const name = PgCallPanel._name();
    const deployed = PgCallPanel._deployed();
    if (!name || !deployed || PgCallPanel.isOpen) return false;
    return readSeen()[name] !== PgCallPanel._seenMark(deployed);
  }

  static get view(): CallView | undefined {
    const s = PgCallPanel._current();
    const { context, engine } = PgConversation.state;
    return callView({
      deployed: PgCallPanel._deployed(),
      live: context
        ? liveInstruction(context.definition, engine.progress.cursor)
        : undefined,
      picked: s.picked,
      values: s.values,
      // An upgrade that lands with the panel open shows on this view too
      showNew: s.showNew || (s.open && PgCallPanel._unseen()),
      last: s.last,
      calling: s.calling,
      busy: running(engine.progress),
      emptyAccounts: emptyAccountsOf(engine.progress.accounts),
    });
  }

  /** The IDL's shape in this walk: a Start over shows the dot and "New" again */
  private static _seenMark(deployed: DeployedIdl) {
    const { restartedAt } = PgConversation.state.engine.progress;
    return `${restartedAt ?? 0}:${shapeOf(deployed.idl)}`;
  }

  private static _unseen() {
    const name = PgCallPanel._name();
    const deployed = PgCallPanel._deployed();
    return (
      !!name &&
      !!deployed &&
      readSeen()[name] !== PgCallPanel._seenMark(deployed)
    );
  }

  private static _markSeen() {
    const name = PgCallPanel._name();
    const deployed = PgCallPanel._deployed();
    if (name && deployed) writeSeen(name, PgCallPanel._seenMark(deployed));
  }

  /** Opens the panel on the live step's instruction */
  static show() {
    const s = PgCallPanel._current();
    if (s.open) return;
    const showNew = PgCallPanel._unseen();
    PgCallPanel._markSeen();
    PgCallPanel._set({ open: true, picked: undefined, showNew });
    // Picked now and kept: a step moving on must not swap the form under them
    PgCallPanel._set({ picked: PgCallPanel.view?.instruction });
  }

  static close() {
    const s = PgCallPanel._current();
    if (!s.open) return;
    PgCallPanel._markSeen();
    PgCallPanel._set({ open: false, showNew: false });
  }

  static toggle() {
    if (PgCallPanel.isOpen) PgCallPanel.close();
    else PgCallPanel.show();
  }

  static setTab(tab: CallPanelTab) {
    PgCallPanel._set({ tab });
  }

  static pick(picked: string) {
    PgCallPanel._set({ picked });
  }

  /** Types into a field of the instruction shown */
  static type(arg: string, value: string) {
    const instruction = PgCallPanel.view?.instruction;
    if (instruction === undefined) return;
    const { values } = PgCallPanel._current();
    PgCallPanel._set({
      values: {
        ...values,
        [instruction]: { ...values[instruction], [arg]: value },
      },
    });
  }

  /** Calls the instruction shown; the result stays in the panel */
  static call() {
    const view = PgCallPanel.view;
    if (!view?.canCall) return Promise.resolve();
    return PgCallPanel._send((call) => PgConversation.callFromPanel(call));
  }

  /**
   * Check again on the latest call, which devnet has not read back: reads the
   * transactions it sent and sends nothing
   */
  static recheck() {
    const view = PgCallPanel.view;
    const { last } = PgCallPanel._current();
    const result = last?.result;
    if (
      !view?.canRecheck ||
      !result ||
      result.ok ||
      !("unconfirmed" in result)
    ) {
      return Promise.resolve();
    }
    const { unconfirmed } = result;
    return PgCallPanel._send((call) =>
      PgConversation.recheckFromPanel(unconfirmed, call)
    );
  }

  /** Runs the instruction shown through `run`; the result stays in the panel */
  private static async _send(
    run: (call: {
      instruction: string;
      args: Record<string, string>;
    }) => Promise<RunResult>
  ) {
    const view = PgCallPanel.view;
    const deployed = PgCallPanel._deployed();
    if (!view || !deployed) return;
    const { instruction } = view;
    const args = Object.fromEntries(view.fields.map((f) => [f.name, f.value]));
    const tutorial = PgCallPanel._name();
    PgCallPanel._set({ calling: true });
    const result = await run({ instruction, args });
    // Another tutorial opened meanwhile: the panel on screen is its own
    const sameTutorial = PgCallPanel._name() === tutorial;
    if (sameTutorial) {
      PgCallPanel._set({
        calling: false,
        last: { instruction, args, deployed, result },
      });
    }
    // After the panel settles, so a print that throws cannot leave Call
    // disabled; at once, as the terminal puts a prompt back after every print
    PgTerminal.println(logLines(instruction, result).join("\n"));
  }
}
