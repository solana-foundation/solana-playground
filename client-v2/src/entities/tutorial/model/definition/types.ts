/**
 * A conversation tutorial as `src/tutorials/<slug>/tutorial.json` holds it.
 * `src/tutorials/tutorial.schema.json` is the source of truth; these types
 * mirror its shape, not every limit (lengths, counts, patterns), and
 * `checkDefinition` is what makes a parsed file one.
 */

/** Inline Markdown, or that text with a shorter phone variant */
export type Text = string | { text: string; phone: string };

/** Whole file contents by workspace path */
export type Files = Record<string, string>;

/** A quiet button after a finish chip's answer; it only opens or shows something */
export type Follow =
  | "openTest"
  | "showMenu"
  | "showFix"
  | "writeClient"
  | "nextTutorial";

/** A finish chip: pressed, it posts its answer with no model call */
export interface Chip {
  label: string;
  answer: Text;
  follow?: Follow;
}

/** Code written into a file; it appears in its step's target for that file,
 * or once in its own `ref` */
export interface Block {
  file: string;
  block: string;
  /** The whole file the block lands in, when that is not the step's target */
  ref?: string;
  /** The file as this write finds it, when that is not the step's start */
  start?: string;
}

export interface Quote {
  file: string;
  line: number;
  mark?: string;
  tone: "lit" | "error";
}

export interface SayBeat {
  kind: "say";
  id: string;
  text: Text;
  quote?: Quote;
}

export interface WriteBeat {
  kind: "write";
  id: string;
  text: Text;
  writes: Block | { create: string };
}

export interface Ask {
  kind: "ask";
  id: string;
  kicker: "Question" | "Fix it";
  question: Text;
  options: [string, string, string];
  code: boolean;
  answer: 0 | 1 | 2;
  right: Text;
  /** Why each option is wrong, by index; null for the right one */
  why: [string | null, string | null, string | null];
  hint: Text;
  writes?: Block;
  skipped?: Text;
  key?: string;
  typed?: Text;
}

/** `airdrop` funds the wallet for the deploy after it (HOO-2677) */
export type Act =
  | "airdrop"
  | "build"
  | "deploy"
  | "buildDeploy"
  | "run"
  | "call";

interface ActBase {
  kind: "act";
  id: string;
  say?: Text;
  title: string;
  context: string;
  button: string;
  /** The card's line once its run landed, before the time it took */
  record?: string;
  /** Only on a `call` act: the card stays one card across its presses */
  repeat?: Repeat;
  /** Only on a `run` or `call` act: the account its cards draw */
  account?: AccountView;
}

/**
 * The account a lesson is about, drawn on its act and result cards. `name` is
 * the account in the instruction, as the IDL names it; field names are as
 * Anchor's coder gives them, camelCase (`lastLogin`).
 */
export type AccountView =
  | {
      kind: "player";
      name: string;
      energy: string;
      wood: string;
      max: number;
      /**
       * The program gives energy back over time: one each `seconds`, counted
       * from the unix time in the field `from`. Absent while it does not yet
       */
      refill?: { seconds: number; from: string };
    }
  | {
      kind: "memory";
      name: string;
      /** The bytes the card's scale ends at */
      capacity: number;
      /** Read in place: nothing is copied to the heap */
      zero?: boolean;
    };

/**
 * A call act pressed again and again. It ends on the step's goal, or on
 * `until`, for a card that is a move on the way to the goal
 */
export interface Repeat {
  /** The button that runs the presses one after another */
  label: string;
  /** A pattern over a press's log line; a match ends the card and flows on */
  until?: string;
}

/**
 * One argument of a call act: a name is a field the learner fills; a value
 * is sent as given, with no field; with `add` (a whole number, at least 1),
 * the value grows by it for each run of the card that landed
 */
export type CallArg =
  | string
  | { name: string; value: string | number; add?: never }
  | { name: string; value: number; add: number };

/** An argument's name, whatever its form */
export const argName = (arg: CallArg): string =>
  typeof arg === "string" ? arg : arg.name;

/** An act card; only a `call` act names its instruction, and it must */
export type ActBeat =
  | (ActBase & {
      act: "call";
      call: {
        instruction: string;
        args?: CallArg[];
        /**
         * The account `instruction` creates with Anchor's `init`, as the IDL
         * names it: a call refused because it already exists (a second pass
         * with the same wallet) is recorded refused, its card says so, and the
         * lesson goes on to the next beat; the step still passes only on its goal
         */
        creates?: string;
      };
    })
  | (ActBase & { act: Exclude<Act, "call">; call?: never });

export type Beat = SayBeat | WriteBeat | Ask | ActBeat;

/** What passes a step, checked on the real result */
export type Goal =
  | { kind: "build"; instructions?: string[] }
  | { kind: "deploy" }
  | {
      kind: "call";
      instruction: string;
      args?: string[];
      log?: string;
      /**
       * The account `instruction` creates with Anchor's `init`, as the IDL
       * names it: the goal also passes when that account already exists
       */
      creates?: string;
    }
  /**
   * A call of `instruction` the program refused, matched by its error (each
   * of the name and code given) and by `log` over the transaction's log;
   * at least one of the two
   */
  | {
      kind: "refused";
      instruction: string;
      error?: RefusedError;
      log?: string;
    };

/** A program error a refused goal names: its name, its code, or both */
export type RefusedError =
  | { name: string; code?: number }
  | { name?: string; code: number };

export interface Win {
  id: string;
  headline: Text;
  line: Text;
  callPanelLine?: Text;
  /** In place of `line` when the goal's `creates` account already existed; only with `creates` */
  existsLine?: Text;
  extra?: "openTest";
}

/**
 * A planned build failure: its card's line, the log line that marks it and
 * the beats after it, all three or none
 */
type PlannedFailure =
  | { planned: Text; failsWith: string; onFail: Beat[] }
  | { planned?: never; failsWith?: never; onFail?: never };

export type Step = PlannedFailure & {
  id: string;
  title: string;
  short: string;
  objective: string;
  learned: string;
  file: string;
  start: Files;
  target: Files;
  /** Files the learner cannot edit in this step */
  readOnly?: string[];
  /**
   * The Anchor IDL of the step's target program, minified to one JSON string
   * and generated with Anchor 1.1.2 (`yarn tutorial:idl`). It holds until the
   * next step that carries one; only a step whose program's IDL changes does
   */
  idl?: string;
  beats: Beat[];
  goal: Goal;
  win: Win;
  explain: Text;
};

/** A doc page the tutorial needs, kept as Markdown in its `docs/` folder */
export interface Doc {
  title: string;
  /** The page on its own site, `https` */
  url: string;
  /** The Markdown file's name in `docs/`: `idl.md` */
  file: string;
}

export interface TutorialDefinition {
  $schema?: string;
  version: 1;
  name: string;
  description: string;
  authors: { name: string; link?: string }[];
  level: "Beginner" | "Intermediate" | "Advanced";
  framework: "Anchor" | "Native" | "Seahorse";
  languages: ("JavaScript" | "Python" | "Rust" | "TypeScript")[];
  categories?: string[];
  thumbnail: string;
  minutes: number;
  intro: {
    /** What the learner ends with */
    promise: Text;
    /** The log line the finished program prints */
    log: string;
    files: Files;
  };
  steps: Step[];
  finish: {
    headline: Text;
    line: Text;
    learned: string[];
    chips: Chip[];
    next: string | null;
  };
  docs?: Doc[];
}

/** One problem in a definition, at its JSON path (`steps[1].beats[3].why[2]`) */
export interface DefinitionError {
  path: string;
  /** What was expected and what was found */
  message: string;
}
