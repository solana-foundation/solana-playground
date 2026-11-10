import { createLogger } from "@/shared/lib/logger";

const log = createLogger("settings-page:sections");

/**
 * The page's sections, in the designed order (Spec 07, "Nine sections in a
 * fixed order"). Account is not drawn yet: sign-in lives in the account menu.
 * Project stays until Export has a place in the project menu.
 */
export const SECTION_ORDER = [
  "network",
  "assistant",
  "editor",
  "build",
  "wallet",
  "appearance",
  "shortcuts",
  "project",
  "advanced",
] as const;

export type SectionId = typeof SECTION_ORDER[number];

const TITLES: Record<SectionId, string> = {
  network: "Network",
  assistant: "Assistant",
  editor: "Editor",
  build: "Build",
  wallet: "Wallet",
  appearance: "Appearance",
  shortcuts: "Keyboard shortcuts",
  project: "Project",
  advanced: "Advanced",
};

export const sectionTitle = (id: SectionId) => TITLES[id];

/** The line under each section's title on a wide window */
export const SECTION_DESCRIPTIONS: Record<SectionId, string> = {
  network: "Where your program deploys and your transactions go.",
  assistant: "The model that answers in chat.",
  editor: "How code looks and behaves while you type.",
  build: "How Playground compiles your program.",
  wallet: "The wallet that signs your deploys and transactions.",
  appearance: "How Playground looks.",
  shortcuts: "Keys for a hardware keyboard.",
  project: "Export this project or open another one.",
  advanced: "Settings most people never change.",
};

/**
 * The tag on anything shown but not offered yet, a setting or one of its
 * values: one word for one state (design alignment, HOO-2695)
 */
export const COMING_SOON = "Coming soon";

/** The small title over a card, when a section holds more than one */
export type GroupId =
  | "links"
  | "transactions"
  | "buildServer"
  | "key"
  | "sources";

export const GROUPS: Record<GroupId, string> = {
  links: "Explorer and logs",
  transactions: "Transactions",
  buildServer: "Build server",
  key: "Your own key",
  sources: "Skills and MCP servers",
};

/** How a setting reads on the page: its section, label and one help line */
export interface RowCopy {
  section: SectionId;
  label: string;
  /** One line, 70 characters at most */
  help: string;
  /** A tag after the label, such as "Experimental" */
  tag?: string;
  /** The titled card the row sits in; untitled when absent */
  group?: GroupId;
  /**
   * Shown but not offered: a setting whose feature is not finished. Its tag
   * says so; no tooltip, since a disabled control cannot be hovered on touch
   * or reached by Tab. A switch already on can still be turned off
   */
  disabled?: true;
  /** Values listed but not selectable, tagged {@link COMING_SOON}: an unfinished choice */
  notReady?: readonly string[];
}

/**
 * Every setting's designed row, in page order within its section (Spec 07,
 * "Settings copy"). The network itself is the Network section's chips, so
 * `connection.endpoint` has no row of its own: its key is present, its value
 * `undefined`, as against a setting nobody designed, which has no key.
 */
export const ROWS: Record<string, RowCopy | undefined> = {
  "connection.endpoint": undefined,
  "blockExplorer.name": {
    section: "network",
    label: "Block explorer",
    help: "Where transaction and account links open.",
    group: "links",
  },
  "notification.showTx": {
    section: "network",
    label: "Transaction links",
    help: "Show an Explorer link after each transaction.",
    group: "links",
  },
  "testUi.showTxDetailsInTerminal": {
    section: "network",
    label: "Transaction details in the terminal",
    // After a call from the Interact stage, `solana confirm -v` on its
    // signature: the transaction's accounts, instructions and logs
    help: "Print transaction details in the terminal after a call.",
    group: "links",
  },
  "editor.keybinding": {
    section: "editor",
    label: "Key bindings",
    help: "Vim keys in the editor.",
  },
  "editor.wordWrap": {
    section: "editor",
    label: "Word wrap",
    help: "Wrap long lines instead of scrolling sideways.",
  },
  "ui.font": {
    section: "editor",
    label: "Code font",
    help: "The font in the editor and the terminal.",
  },
  "build.improveErrors": {
    section: "build",
    label: "Shorter build errors",
    help: "Trim compiler output to the part that matters.",
    tag: "Experimental",
  },
  "wallet.automaticAirdrop": {
    section: "wallet",
    label: "Automatic airdrop",
    help: "Top up your Playground wallet with devnet SOL when it runs low.",
  },
  "ui.theme": {
    section: "appearance",
    label: "Theme",
    help: "Colors for the whole app.",
    // Agreed on the 7 Nov call: the light theme was never designed, so it is
    // shown, not offered, until it is (HOO-2702)
    notReady: ["Light"],
  },
  "connection.commitment": {
    section: "advanced",
    label: "Commitment",
    help: "How final a transaction must be before Playground reports it.",
    group: "transactions",
  },
  "connection.priorityFee": {
    section: "advanced",
    label: "Priority fee",
    help: "How the fee is chosen to get transactions in faster.",
    group: "transactions",
  },
  "connection.preflightChecks": {
    section: "advanced",
    label: "Preflight checks",
    help: "Simulate each transaction before sending it.",
    group: "transactions",
  },
  "server.endpoint": {
    section: "advanced",
    label: "Build server",
    help: "The server that builds your program.",
    group: "buildServer",
  },
  "experimental.unstable": {
    section: "advanced",
    label: "Sandboxed builds",
    help: "Build through the server's unstable routes, if it has them.",
    // No hosted server has those routes yet (HOO-1600), so the switch could
    // only break builds: shown, not offered
    tag: COMING_SOON,
    disabled: true,
    group: "buildServer",
  },
};

/** Settings already reported, so a page that re-renders on every scroll reports each once */
const reported = new Set<string>();

/** What grouping reads of a setting */
interface Groupable {
  id: string;
  name: string;
}

export interface SettingRow<S extends Groupable> extends RowCopy {
  setting: S;
}

const position = (id: string) => {
  const at = Object.keys(ROWS).indexOf(id);
  return at === -1 ? Infinity : at;
};

/**
 * `PgSettings.all` as the page's rows, by section and in `ROWS` order. A
 * setting `ROWS` does not know goes to the end of Advanced under its own
 * name, and is reported once so that it gets designed rather than going
 * unnoticed.
 */
export const settingRows = <S extends Groupable>(
  all: S[]
): Map<SectionId, SettingRow<S>[]> => {
  const rows = new Map<SectionId, SettingRow<S>[]>();
  const sorted = [...all].sort((a, b) => position(a.id) - position(b.id));
  for (const setting of sorted) {
    let copy = ROWS[setting.id];
    if (copy === undefined && setting.id in ROWS) continue;
    if (!copy) {
      if (!reported.has(setting.id)) {
        reported.add(setting.id);
        log.warn("a setting has no designed row", {
          report: true,
          context: { setting: setting.id },
        });
      }
      copy = { section: "advanced", label: setting.name, help: "" };
    }
    rows.set(copy.section, [
      ...(rows.get(copy.section) ?? []),
      { ...copy, setting },
    ]);
  }
  return rows;
};

if (import.meta.vitest) {
  const { describe, it, expect, beforeAll } = import.meta.vitest;

  describe("widgets/settings-page/model/sections", () => {
    let logger: typeof import("@/shared/lib/logger");
    beforeAll(async () => {
      logger = await import("@/shared/lib/logger");
    });

    const setting = (id: string, name = id) => ({ id, name });

    it("puts each setting in its designed section, in the designed order", () => {
      const rows = settingRows([
        setting("connection.preflightChecks"),
        setting("ui.theme"),
        setting("connection.commitment"),
        setting("editor.wordWrap"),
        setting("editor.keybinding"),
      ]);
      expect(rows.get("editor")?.map((r) => r.label)).toEqual([
        "Key bindings",
        "Word wrap",
      ]);
      expect(rows.get("appearance")?.map((r) => r.label)).toEqual(["Theme"]);
      expect(rows.get("advanced")?.map((r) => r.label)).toEqual([
        "Commitment",
        "Preflight checks",
      ]);
    });

    it("draws no row for the endpoint, which the network chips set", () => {
      const rows = settingRows([setting("connection.endpoint")]);
      expect([...rows.values()].flat()).toEqual([]);
    });

    it("keeps every help line to one line of 70 characters", () => {
      for (const copy of Object.values(ROWS)) {
        if (copy) expect(copy.help.length).toBeLessThanOrEqual(70);
      }
      const labels = Object.values(ROWS).flatMap((c) => (c ? [c.label] : []));
      expect(new Set(labels).size).toBe(labels.length);
    });

    it("titles the sections in the designed order", () => {
      expect(SECTION_ORDER.map(sectionTitle)).toEqual([
        "Network",
        "Assistant",
        "Editor",
        "Build",
        "Wallet",
        "Appearance",
        "Keyboard shortcuts",
        "Project",
        "Advanced",
      ]);
    });

    it("puts a setting it does not know at the end of Advanced and reports it once", () => {
      const logged = logger.memoryProvider();
      logger.initLogger({ providers: [logged] });
      const all = [setting("onceOnly.flag", "Flag")];
      settingRows(all);
      const rows = settingRows(all);
      logger.resetLogger();
      expect(rows.get("advanced")?.map((r) => r.label)).toEqual(["Flag"]);
      const reports = logged.entries.filter(
        (entry) => entry.context?.setting === "onceOnly.flag"
      );
      expect(reports).toHaveLength(1);
    });
  });
}
