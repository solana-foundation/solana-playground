import Ajv from "ajv";
import type { ErrorObject, ValidateFunction } from "ajv";

// Relative on purpose: `yarn tutorial:check` runs this module through tsx,
// with no `@/` alias, and the schema sits beside the definitions it checks
import schema from "../../../../tutorials/tutorial.schema.json";
import { argName } from "./types";
import type {
  Block,
  Beat,
  DefinitionError,
  Files,
  Step,
  TutorialDefinition,
} from "./types";

let compiled: ValidateFunction | undefined;

/** The schema's validator, compiled on first use rather than on import */
const validator = () => {
  compiled ??= new Ajv({
    allErrors: true,
    discriminator: true,
    allowUnionTypes: true,
    // Errors carry the value and the schema they failed, for the message
    verbose: true,
  }).compile(schema);
  return compiled;
};

/**
 * Every problem in a parsed `tutorial.json`; empty when it is a definition.
 * The schema runs first; the rules a schema cannot express (a right index in
 * range, a reason per wrong option and none for the right one, blocks found
 * in their target, instructions some step's target defines, a `next` in
 * `known`, ids used once, patterns that compile, read-only files the step
 * has, a call act's argument names used once, doc files that exist and link
 * only to `https`) run only on a definition
 * the schema accepts, since they read its shape. The folder-name error leads,
 * then the rules' errors in step order.
 *
 * @param known every tutorial slug `finish.next` may name
 */
export const checkDefinition = (
  json: unknown,
  known: ReadonlySet<string>,
  { slug, docs }: CheckOptions = {}
): DefinitionError[] => {
  const validate = validator();
  if (!validate(json)) {
    const errors = schemaErrors(validate.errors ?? []);
    // Never pass a definition the schema refused because every one of its
    // errors was folded away as a branch of another
    return errors.length > 0
      ? errors
      : [
          {
            path: ROOT,
            message: "a definition the schema accepts, found one it refuses",
          },
        ];
  }
  const d = json as TutorialDefinition;
  const errors = ruleErrors(d, known, docs);
  if (slug !== undefined && slugOf(d.name) !== slug) {
    errors.unshift({
      path: "name",
      message: `a name whose slug is the folder's, ${JSON.stringify(
        slug
      )}, found ${JSON.stringify(d.name)}`,
    });
  }
  return errors;
};

export interface CheckOptions {
  /**
   * The folder the definition sits in, which its name must give: routes and
   * saved workspaces are named from the name
   */
  slug?: string;
  /**
   * The Markdown in the tutorial's `docs/` folder, by file name. Without it
   * the doc files go unchecked: the app's loader has no folder to read, and
   * `yarn tutorial:check` in CI is where a missing page fails
   */
  docs?: Readonly<Record<string, string>>;
}

/** A tutorial's slug from its name, as `PgCommon.toKebabFromTitle` makes it */
export const slugOf = (name: string) =>
  name
    .split(" ")
    .map((w) => w.toLowerCase())
    .join("-")
    .replace(/[^\w-]/g, "")
    .replaceAll("--", "-")
    .replace(/^-/, "")
    .replace(/-$/, "");

/** One error as the check prints it */
export const formatError = (e: DefinitionError) => `${e.path}: ${e.message}`;

/** A found value in a few words */
const found = (value: unknown): string => {
  if (value === undefined) return "none";
  if (Array.isArray(value)) return `a list of ${value.length}`;
  if (value !== null && typeof value === "object") return "an object";
  const text = JSON.stringify(value);
  return text.length > 60 ? `${text.slice(0, 57)}..."` : text;
};

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** A JSON pointer (`/steps/1/why/2`) as a path (`steps[1].why[2]`) */
const pathOf = (pointer: string, extra?: string): string => {
  const segments = pointer
    .split("/")
    .slice(1)
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
  if (extra !== undefined) segments.push(extra);
  return segments.reduce((path, s) => {
    if (/^\d+$/.test(s)) return `${path}[${s}]`;
    if (IDENTIFIER.test(s)) return path ? `${path}.${s}` : s;
    return `${path}[${JSON.stringify(s)}]`;
  }, "");
};

const ROOT = "(root)";

const quoted = (values: unknown[]) =>
  values.map((v) => JSON.stringify(v)).join(", ");

/** What a failed keyword expected, in words */
const expected = (e: ErrorObject): string => {
  const p = e.params as Record<string, unknown>;
  switch (e.keyword) {
    case "type":
      return `a ${String(p.type).split(",").join(" or ")}`;
    case "const":
      return JSON.stringify(p.allowedValue);
    case "enum":
      return `one of ${quoted(p.allowedValues as unknown[])}`;
    case "minItems":
      return `at least ${p.limit} items`;
    case "maxItems":
      return `at most ${p.limit} items`;
    case "minLength":
      return p.limit === 1
        ? "a non-empty string"
        : `at least ${p.limit} characters`;
    case "minimum":
      return `at least ${p.limit}`;
    case "pattern":
      return `text matching /${p.pattern}/`;
    case "uniqueItems":
      return `no item twice (items ${p.j} and ${p.i} are equal)`;
    case "anyOf":
      return e.schemaPath.includes("/text/")
        ? "a string, or { text, phone }"
        : "one of the shapes the schema allows";
    default:
      return e.message ?? e.keyword;
  }
};

/** Ajv's errors as paths, one line per field */
const schemaErrors = (raw: ErrorObject[]): DefinitionError[] => {
  // An anyOf reports each branch's failure, then its own: keep only its own
  const unions = raw.filter((e) => e.keyword === "anyOf");
  const inUnion = (e: ErrorObject) =>
    unions.some(
      (u) =>
        u !== e &&
        e.schemaPath.startsWith(u.schemaPath.replace(/anyOf$/, "")) &&
        (e.instancePath === u.instancePath ||
          e.instancePath.startsWith(`${u.instancePath}/`))
    );
  const errors: DefinitionError[] = [];
  for (const e of raw) {
    // `if` only says its `then` failed, which has its own error
    if (e.keyword === "if" || inUnion(e)) continue;
    // The act's `else`: a `call` on an act that does not call
    if (e.keyword === "not" && e.schemaPath.endsWith("/else/not")) {
      errors.push({
        path: pathOf(e.instancePath, "call"),
        message: "no call on an act other than `call`, found one",
      });
      continue;
    }
    // A property name's own error is reported by `propertyNames`
    if (e.propertyName !== undefined) continue;
    const p = e.params as Record<string, unknown>;
    const at = pathOf(e.instancePath);
    if (e.keyword === "required" || e.keyword === "dependencies") {
      errors.push({
        path: at || ROOT,
        message: `needs ${JSON.stringify(p.missingProperty)}, found none`,
      });
    } else if (e.keyword === "additionalProperties") {
      const name = String(p.additionalProperty);
      errors.push({
        path: pathOf(e.instancePath, name),
        message: `no such field, found ${found(
          (e.data as Record<string, unknown>)[name]
        )}`,
      });
    } else if (e.keyword === "propertyNames") {
      errors.push({
        path: at || ROOT,
        message: `a relative file path, found ${JSON.stringify(
          p.propertyName
        )}`,
      });
    } else if (e.keyword === "discriminator") {
      errors.push({
        path: pathOf(e.instancePath, String(p.tag)),
        message: `one of ${quoted(kindsAt(e))}, found ${found(p.tagValue)}`,
      });
    } else {
      errors.push({
        path: at || ROOT,
        message: `${expected(e)}, found ${found(e.data)}`,
      });
    }
  }
  return errors;
};

/** The `kind`s a discriminated union allows, read from its branches */
const kindsAt = (e: ErrorObject): string[] =>
  ((e.parentSchema as { oneOf: { $ref: string }[] }).oneOf ?? []).map(
    (branch) => {
      const name = branch.$ref?.split("/").pop() ?? "";
      const definitions = schema.definitions as Record<
        string,
        { properties?: { kind?: { const?: string } } }
      >;
      return definitions[name]?.properties?.kind?.const ?? name;
    }
  );

/** A step's beats with their paths, the planned failure's too */
const beatsOf = (step: Step, i: number): [Beat, string][] => [
  ...step.beats.map((b, j): [Beat, string] => [b, `steps[${i}].beats[${j}]`]),
  ...(step.onFail ?? []).map((b, j): [Beat, string] => [
    b,
    `steps[${i}].onFail[${j}]`,
  ]),
];

/** Code lines as a block is compared: trimmed, blank lines dropped */
const codeLines = (code: string) =>
  code
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

/** How many times `file` holds `block`'s lines in a row, indentation and blank lines aside */
const timesHeld = (file: string, block: string) => {
  const want = codeLines(block);
  const have = codeLines(file);
  if (want.length === 0) return 0;
  let times = 0;
  for (let i = 0; i + want.length <= have.length; i++) {
    if (want.every((line, k) => have[i + k] === line)) times++;
  }
  return times;
};

/** Whether `file` holds `block`'s lines in a row, indentation and blank lines aside */
const holds = (file: string, block: string) => timesHeld(file, block) > 0;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether any of the files defines `fn <name>` */
const defines = (files: string[], name: string) => {
  const fn = new RegExp(`\\bfn\\s+${escapeRegExp(name)}\\s*[(<]`);
  return files.some((f) => fn.test(f));
};

const compiles = (pattern: string) => {
  try {
    new RegExp(pattern, "i");
    return true;
  } catch {
    // The caller reports it as the definition's error
    return false;
  }
};

/** Markdown with its code blocks and code spans blanked, so code is not read as links */
const proseOf = (markdown: string) =>
  markdown
    .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[^\n]*$/gm, "")
    .replace(/(`+)[\s\S]*?\1/g, "");

const LINKS = [
  // [text](address "title") and ![alt](address)
  /!?\[[^\]]*\]\(\s*<?([^\s)>]*)>?[^)]*\)/g,
  // <scheme:address>
  /<([a-z][a-z\d+.-]*:[^\s>]*)>/gi,
  // [label]: address
  /^ {0,3}\[[^\]]+\]:\s*<?([^\s>]+)>?/gm,
];

/** Every link address in a Markdown page */
const linksOf = (markdown: string): string[] => {
  const prose = proseOf(markdown);
  return LINKS.flatMap((re) => [...prose.matchAll(re)].map((m) => m[1]));
};

const isHttps = (address: string) => /^https:\/\/\S/.test(address);

/** The rules a schema cannot express, over a definition the schema accepted */
const ruleErrors = (
  d: TutorialDefinition,
  known: ReadonlySet<string>,
  docs: CheckOptions["docs"]
): DefinitionError[] => {
  const errors: DefinitionError[] = [];
  const targets = d.steps.flatMap((s) => Object.values(s.target));
  const beatIds = new Map<string, string>();
  const stepIds = new Map<string, string>();
  const docFiles = new Map<string, string>();

  const once = (
    ids: Map<string, string>,
    id: string,
    path: string,
    what: string
  ) => {
    const first = ids.get(id);
    if (first === undefined) {
      ids.set(id, path);
      return;
    }
    errors.push({
      path,
      message: `an id no other ${what} has, found ${JSON.stringify(
        id
      )}, also at ${first}`,
    });
  };

  const pattern = (value: string | undefined, path: string) => {
    if (value !== undefined && !compiles(value)) {
      errors.push({
        path,
        message: `a regular expression, found ${JSON.stringify(value)}`,
      });
    }
  };

  const block = (target: Files, writes: Block, at: string) => {
    const file = target[writes.file];
    if (writes.ref !== undefined) {
      // A write with its own reference lands where that file has it, so
      // there it must be, and in one place only
      const times = timesHeld(writes.ref, writes.block);
      if (times === 0) {
        errors.push({
          path: `${at}.block`,
          message: `a block in its ref, found ${found(
            codeLines(writes.block)[0] ?? ""
          )}`,
        });
      } else if (times > 1) {
        errors.push({
          path: `${at}.ref`,
          message: `a ref holding the block once, found it ${times} times`,
        });
      }
    }
    if (file === undefined) {
      errors.push({
        path: `${at}.file`,
        message: `a file in the step's target, found ${JSON.stringify(
          writes.file
        )}`,
      });
    } else if (writes.ref === undefined && !holds(file, writes.block)) {
      errors.push({
        path: `${at}.block`,
        message: `a block in the step's target ${writes.file}, found ${found(
          codeLines(writes.block)[0] ?? ""
        )}`,
      });
    }
  };

  d.steps.forEach((step, i) => {
    once(stepIds, step.id, `steps[${i}].id`, "step");
    step.readOnly?.forEach((file, k) => {
      if (step.start[file] === undefined && step.target[file] === undefined) {
        errors.push({
          path: `steps[${i}].readOnly[${k}]`,
          message: `a file in the step's start or target, found ${JSON.stringify(
            file
          )}`,
        });
      }
    });
    for (const [beat, at] of beatsOf(step, i)) {
      once(beatIds, beat.id, `${at}.id`, "beat");
      if (beat.kind === "write") {
        if ("create" in beat.writes) {
          if (step.target[beat.writes.create] === undefined) {
            errors.push({
              path: `${at}.writes.create`,
              message: `a file in the step's target, found ${JSON.stringify(
                beat.writes.create
              )}`,
            });
          }
        } else {
          block(step.target, beat.writes, `${at}.writes`);
        }
      }
      if (beat.kind === "ask") {
        if (![0, 1, 2].includes(beat.answer)) {
          errors.push({
            path: `${at}.answer`,
            message: `the right option is 0, 1 or 2, found ${found(
              beat.answer
            )}`,
          });
        } else {
          beat.why.forEach((why, k) => {
            if (k !== beat.answer && !why) {
              errors.push({
                path: `${at}.why[${k}]`,
                message: `a wrong option needs a reason, found ${found(why)}`,
              });
            } else if (k === beat.answer && why !== null) {
              errors.push({
                path: `${at}.why[${k}]`,
                message: `null at the right option, found ${found(why)}`,
              });
            }
          });
        }
        if (beat.writes) block(step.target, beat.writes, `${at}.writes`);
      }
      if (beat.kind === "act" && beat.act === "call") {
        // A name twice would send one value over the other
        const named = new Map<string, string>();
        beat.call.args?.forEach((arg, k) => {
          const path = `${at}.call.args[${k}]`;
          const name = argName(arg);
          const first = named.get(name);
          if (first === undefined) {
            named.set(name, path);
            return;
          }
          errors.push({
            path,
            message: `a name no other argument of this call has, found ${JSON.stringify(
              name
            )}, also at ${first}`,
          });
        });
      }
    }

    const goal = step.goal;
    const instruction = (name: string, path: string) => {
      if (!defines(targets, name)) {
        errors.push({
          path,
          message: `an instruction a step's target defines, found ${JSON.stringify(
            name
          )}`,
        });
      }
    };
    if (goal.kind === "build") {
      goal.instructions?.forEach((name, k) =>
        instruction(name, `steps[${i}].goal.instructions[${k}]`)
      );
    } else if (goal.kind === "call" || goal.kind === "refused") {
      instruction(goal.instruction, `steps[${i}].goal.instruction`);
      pattern(goal.log, `steps[${i}].goal.log`);
    }
  });

  if (d.finish.next !== null && !known.has(d.finish.next)) {
    errors.push({
      path: "finish.next",
      message: `the slug of a tutorial, found ${JSON.stringify(d.finish.next)}`,
    });
  }

  d.docs?.forEach((doc, k) => {
    const at = `docs[${k}].file`;
    once(docFiles, doc.file, at, "doc");
    if (docs === undefined) return;
    const markdown = docs[doc.file];
    if (markdown === undefined) {
      errors.push({
        path: at,
        message: `a Markdown file in the tutorial's docs folder, found no ${JSON.stringify(
          doc.file
        )} there`,
      });
      return;
    }
    for (const address of linksOf(markdown).filter((a) => !isHttps(a))) {
      errors.push({
        path: at,
        message: `https links only, found ${JSON.stringify(address)} in ${
          doc.file
        }`,
      });
    }
  });
  return errors;
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;
  type TutorialDefinition = import("./types").TutorialDefinition;
  type Ask = import("./types").Ask;
  type WriteBeat = import("./types").WriteBeat;
  type Beat = import("./types").Beat;

  describe("entities/tutorial/model/definition/check", () => {
    const LIB =
      "use anchor_lang::prelude::*;\n\npub fn hello(name: String) {\n    msg!(name);\n}\n";

    const ask = (id: string): Ask => ({
      kind: "ask",
      id,
      kicker: "Question",
      question: "Which line?",
      options: ["a", "b", "c"],
      code: true,
      answer: 0,
      right: "Yes.",
      why: [null, "Not b.", "Not c."],
      hint: "Think.",
    });

    /** A two-step definition that passes: the second step's beats[3] is a question */
    const minimal = (): TutorialDefinition => ({
      version: 1,
      name: "Minimal",
      description: "The smallest tutorial.",
      authors: [{ name: "Fleet" }],
      level: "Beginner",
      framework: "Anchor",
      languages: ["Rust"],
      thumbnail: "thumbnail.jpg",
      minutes: 5,
      intro: {
        promise: "You write hello.",
        log: "Program log: hi",
        files: { "src/lib.rs": LIB },
      },
      steps: [
        {
          id: "program",
          title: "Program",
          short: "Program",
          objective: "Write hello",
          learned: "Instructions",
          file: "src/lib.rs",
          start: { "src/lib.rs": "" },
          target: { "src/lib.rs": LIB },
          beats: [
            {
              kind: "write",
              id: "s1.boil",
              text: "The import.",
              writes: {
                file: "src/lib.rs",
                block: "use anchor_lang::prelude::*;",
              },
            },
            {
              kind: "act",
              id: "s1.build",
              act: "build",
              title: "Build",
              context: "Compiles lib.rs",
              button: "Build",
            },
          ],
          goal: { kind: "build", instructions: ["hello"] },
          win: {
            id: "s1.win",
            headline: "Built.",
            line: "One instruction.",
          },
          explain: "This step writes hello.",
        },
        {
          id: "call",
          title: "Call",
          short: "Call",
          objective: "Call hello",
          learned: "Calls",
          file: "src/lib.rs",
          start: { "src/lib.rs": LIB },
          target: { "src/lib.rs": LIB },
          beats: [
            { kind: "say", id: "s2.a", text: "One." },
            { kind: "say", id: "s2.b", text: "Two." },
            { kind: "say", id: "s2.c", text: "Three." },
            ask("s2.q"),
          ],
          goal: {
            kind: "call",
            instruction: "hello",
            args: ["name"],
            log: "hi",
          },
          win: {
            id: "s2.win",
            headline: "Called.",
            line: "It said hi.",
          },
          explain: "This step calls hello.",
        },
      ],
      finish: {
        headline: "Done.",
        line: "You called hello.",
        learned: ["Instructions", "Calls"],
        chips: [],
        next: "counter-pda-tutorial",
      },
    });

    const KNOWN = new Set(["minimal", "counter-pda-tutorial"]);
    const lines = (d: unknown) => checkDefinition(d, KNOWN).map(formatError);
    const askAt = (d: TutorialDefinition, step: number, beat: number) =>
      d.steps[step].beats[beat] as Ask;

    it("passes a well-formed definition", () => {
      expect(lines(minimal())).toEqual([]);
    });

    it("names a wrong option with no reason by its path", () => {
      const d = minimal();
      askAt(d, 1, 3).why[2] = null;
      expect(lines(d)).toEqual([
        "steps[1].beats[3].why[2]: a wrong option needs a reason, found null",
      ]);
    });

    it("rejects a right index outside 0 to 2", () => {
      const d = minimal();
      (askAt(d, 1, 3) as { answer: number }).answer = 3;
      expect(lines(d)).toEqual([
        "steps[1].beats[3].answer: the right option is 0, 1 or 2, found 3",
      ]);
    });

    it("names the beat and the file of a block the target does not hold", () => {
      const d = minimal();
      const q = askAt(d, 1, 3);
      q.writes = { file: "src/lib.rs", block: "pub fn goodbye() {}" };
      expect(lines(d)).toEqual([
        'steps[1].beats[3].writes.block: a block in the step\'s target src/lib.rs, found "pub fn goodbye() {}"',
      ]);
    });

    it("reads a block line by line, indentation aside", () => {
      const d = minimal();
      const q = askAt(d, 1, 3);
      q.writes = {
        file: "src/lib.rs",
        block: "pub fn hello(name: String) {\nmsg!(name);",
      };
      expect(lines(d)).toEqual([]);
    });

    it("names a write into a file the target lacks", () => {
      const d = minimal();
      (d.steps[0].beats[0] as WriteBeat).writes = {
        file: "src/other.rs",
        block: "x",
      };
      expect(lines(d)).toEqual([
        'steps[0].beats[0].writes.file: a file in the step\'s target, found "src/other.rs"',
      ]);
    });

    it("rejects a goal naming an instruction no target defines", () => {
      const d = minimal();
      d.steps[1].goal = { kind: "call", instruction: "goodbye" };
      expect(lines(d)).toEqual([
        'steps[1].goal.instruction: an instruction a step\'s target defines, found "goodbye"',
      ]);
    });

    it("rejects a next slug that names no tutorial", () => {
      const d = minimal();
      d.finish.next = "nowhere";
      expect(lines(d)).toEqual([
        'finish.next: the slug of a tutorial, found "nowhere"',
      ]);
    });

    it("names both places of a beat id used twice", () => {
      const d = minimal();
      d.steps[1].beats[0].id = "s1.boil";
      expect(lines(d)).toEqual([
        'steps[1].beats[0].id: an id no other beat has, found "s1.boil", also at steps[0].beats[0].id',
      ]);
    });

    it("rejects a pattern that is not a regular expression", () => {
      const d = minimal();
      d.steps[1].goal = { kind: "call", instruction: "hello", log: "(" };
      expect(lines(d)).toEqual([
        'steps[1].goal.log: a regular expression, found "("',
      ]);
    });

    it("names a missing field", () => {
      const d = minimal() as unknown as { steps: Record<string, unknown>[] };
      delete d.steps[0].title;
      expect(lines(d)).toEqual(['steps[0]: needs "title", found none']);
    });

    it("gives a text of the wrong shape one line", () => {
      const d = minimal() as unknown as { steps: { explain: unknown }[] };
      d.steps[0].explain = 3;
      expect(lines(d)).toEqual([
        "steps[0].explain: a string, or { text, phone }, found 3",
      ]);
    });

    it("names an unknown beat kind on its kind", () => {
      const d = minimal() as unknown as {
        steps: { beats: { kind: string }[] }[];
      };
      d.steps[1].beats[0].kind = "shout";
      expect(lines(d)).toEqual([
        'steps[1].beats[0].kind: one of "say", "write", "ask", "act", found "shout"',
      ]);
    });

    it("names an unknown field", () => {
      const d = minimal() as unknown as Record<string, unknown>;
      d.colour = "red";
      expect(lines(d)).toEqual(['colour: no such field, found "red"']);
    });

    it("writes a file path key in brackets", () => {
      const d = minimal() as unknown as {
        intro: { files: Record<string, unknown> };
      };
      d.intro.files["src/lib.rs"] = 1;
      expect(lines(d)).toEqual([
        'intro.files["src/lib.rs"]: a string, found 1',
      ]);
    });

    it("needs a call for a call act", () => {
      const d = minimal();
      d.steps[0].beats[1] = {
        kind: "act",
        id: "s1.build",
        act: "call",
        title: "Call",
        context: "Sends hello",
        button: "Call",
      } as unknown as Beat;
      expect(lines(d)).toEqual(['steps[0].beats[1]: needs "call", found none']);
    });

    it("needs the name to give the folder's slug", () => {
      expect(checkDefinition(minimal(), KNOWN, { slug: "minimal" })).toEqual(
        []
      );
      expect(
        checkDefinition(minimal(), KNOWN, { slug: "other" }).map(formatError)
      ).toEqual([
        'name: a name whose slug is the folder\'s, "other", found "Minimal"',
      ]);
    });

    it("rejects a call on an act that does not call", () => {
      const d = minimal();
      Object.assign(d.steps[0].beats[1], { call: { instruction: "hello" } });
      expect(lines(d)).toEqual([
        "steps[0].beats[1].call: no call on an act other than `call`, found one",
      ]);
    });

    describe("a refused goal", () => {
      it("accepts one by error name and code, or by a log pattern", () => {
        const d = minimal();
        d.steps[1].goal = {
          kind: "refused",
          instruction: "hello",
          error: { name: "NotEnoughEnergy", code: 6000 },
        };
        expect(lines(d)).toEqual([]);
        d.steps[1].goal = {
          kind: "refused",
          instruction: "hello",
          log: "out of memory",
        };
        expect(lines(d)).toEqual([]);
        d.steps[1].goal = {
          kind: "refused",
          instruction: "hello",
          error: { code: 6000 },
          log: "Not enough energy",
        };
        expect(lines(d)).toEqual([]);
      });

      it("rejects one that names neither an error nor a log", () => {
        const d = minimal();
        d.steps[1].goal = { kind: "refused", instruction: "hello" };
        expect(lines(d)).toEqual([
          "steps[1].goal: one of the shapes the schema allows, found an object",
        ]);
      });

      it("rejects an error with neither a name nor a code", () => {
        const d = minimal();
        d.steps[1].goal = {
          kind: "refused",
          instruction: "hello",
          error: {},
        } as unknown as TutorialDefinition["steps"][number]["goal"];
        expect(lines(d)).toEqual([
          "steps[1].goal.error: one of the shapes the schema allows, found an object",
        ]);
      });

      it("rejects an instruction no target defines, and a pattern that does not compile", () => {
        const d = minimal();
        d.steps[1].goal = {
          kind: "refused",
          instruction: "goodbye",
          log: "(",
        };
        expect(lines(d)).toEqual([
          'steps[1].goal.instruction: an instruction a step\'s target defines, found "goodbye"',
          'steps[1].goal.log: a regular expression, found "("',
        ]);
      });
    });

    describe("a call act's arguments and an act's record line", () => {
      const callAct = (args: unknown[]): Beat =>
        ({
          kind: "act",
          id: "s2.call",
          act: "call",
          title: "Call",
          context: "Sends hello",
          button: "Grow",
          record: "Created your map · 10 KB",
          call: { instruction: "hello", args },
        } as unknown as Beat);

      it("accepts a field, a fixed value and a growing value, and a record line", () => {
        const d = minimal();
        d.steps[1].beats[0] = callAct([
          "name",
          { name: "text", value: "gm" },
          { name: "at", value: 35000 },
          { name: "len", value: 20480, add: 10240 },
        ]);
        expect(lines(d)).toEqual([]);
      });

      it("rejects an argument named twice on one act", () => {
        const d = minimal();
        d.steps[1].beats[0] = callAct(["len", { name: "len", value: 1 }]);
        expect(lines(d)).toEqual([
          'steps[1].beats[0].call.args[1]: a name no other argument of this call has, found "len", also at steps[1].beats[0].call.args[0]',
        ]);
      });

      it("rejects an amount to add on a value that is not a whole number", () => {
        const d = minimal();
        d.steps[1].beats[0] = callAct([
          { name: "len", value: "big", add: 10240 },
        ]);
        expect(lines(d)).toEqual([
          "steps[1].beats[0].call.args[0]: one of the shapes the schema allows, found an object",
        ]);
      });
    });

    it("rejects a reason at the right option", () => {
      const d = minimal();
      askAt(d, 1, 3).why[0] = "Right, but why?";
      expect(lines(d)).toEqual([
        'steps[1].beats[3].why[0]: null at the right option, found "Right, but why?"',
      ]);
    });

    /** Step 1 with a planned failure whose beats are given */
    const withPlannedFailure = (d: TutorialDefinition, onFail: Beat[]) => {
      Object.assign(d.steps[0], { planned: "On purpose.", onFail });
      return d;
    };

    it("checks the planned failure's beats like the step's own", () => {
      const fix = ask("f1.fix");
      fix.why[1] = null;
      const d = withPlannedFailure(minimal(), [fix]);
      expect(lines(d)).toEqual([
        "steps[0].onFail[0].why[1]: a wrong option needs a reason, found null",
      ]);
    });

    it("counts an id used in the planned failure and a step's beats", () => {
      const d = withPlannedFailure(minimal(), [ask("s2.q")]);
      expect(lines(d)).toEqual([
        'steps[1].beats[3].id: an id no other beat has, found "s2.q", also at steps[0].onFail[0].id',
      ]);
    });

    it("needs a planned failure's line with its beats", () => {
      const d = minimal();
      Object.assign(d.steps[0], { onFail: [ask("f1.fix")] });
      expect(lines(d)).toEqual(['steps[0]: needs "planned", found none']);
    });

    it("rejects a build goal naming an instruction no target defines", () => {
      const d = minimal();
      d.steps[0].goal = { kind: "build", instructions: ["hello", "goodbye"] };
      expect(lines(d)).toEqual([
        'steps[0].goal.instructions[1]: an instruction a step\'s target defines, found "goodbye"',
      ]);
    });

    it("finds an instruction by its whole name", () => {
      const d = minimal();
      d.steps[1].goal = { kind: "call", instruction: "hell" };
      expect(lines(d)).toEqual([
        'steps[1].goal.instruction: an instruction a step\'s target defines, found "hell"',
      ]);
    });

    it("checks the call goal's log pattern", () => {
      const d = minimal();
      d.steps[1].goal = { kind: "call", instruction: "hello", log: "(" };
      expect(lines(d)).toEqual([
        'steps[1].goal.log: a regular expression, found "("',
      ]);
    });

    it("refuses scripted answers to typed text, step chips and win stats", () => {
      const d = minimal() as unknown as {
        steps: Record<string, unknown>[];
        finish: { chips: unknown[] };
      };
      d.steps[0].chips = [];
      d.steps[1].matches = [{ pattern: "hi", answer: "c" }];
      Object.assign(d.steps[0].win as object, { stats: [] });
      d.finish.chips = [{ label: "SOL?", answer: "Test SOL.", pattern: "sol" }];
      expect(lines(d)).toEqual([
        "steps[0].chips: no such field, found a list of 0",
        "steps[0].win.stats: no such field, found a list of 0",
        "steps[1].matches: no such field, found a list of 1",
        'finish.chips[0].pattern: no such field, found "sol"',
      ]);
    });

    it("needs a read-only file the step has", () => {
      const d = minimal();
      d.steps[0].readOnly = ["src/lib.rs", "Anchor.toml"];
      expect(lines(d)).toEqual([
        'steps[0].readOnly[1]: a file in the step\'s start or target, found "Anchor.toml"',
      ]);
    });

    /** `minimal` with two docs, checked against the given docs folder */
    const withDocs = (folder: Record<string, string>) => {
      const d = minimal();
      d.docs = [
        {
          title: "IDL",
          url: "https://www.anchor-lang.com/docs/basics/idl",
          file: "idl.md",
        },
        {
          title: "Programs",
          url: "https://solana.com/docs/core/programs",
          file: "programs.md",
        },
      ];
      return checkDefinition(d, KNOWN, { docs: folder }).map(formatError);
    };

    it("passes docs whose pages are there and link to https", () => {
      expect(
        withDocs({
          "idl.md":
            "# IDL\n\nSee [the spec](https://solana.com/docs) and <https://anchor-lang.com>.\n\n[ref]: https://github.com/coral-xyz/anchor\n",
          "programs.md":
            "Code is not a link: `[a](http://x)`\n\n```md\n[b](http://y)\n```\n",
        })
      ).toEqual([]);
    });

    it("names a doc whose Markdown file is missing", () => {
      expect(withDocs({ "idl.md": "# IDL\n" })).toEqual([
        'docs[1].file: a Markdown file in the tutorial\'s docs folder, found no "programs.md" there',
      ]);
    });

    it("names every link in a doc that is not https", () => {
      expect(
        withDocs({
          "idl.md":
            "[a](http://anchor-lang.com) ![b](img/idl.png) <http://solana.com>\n\n[c]: ./programs.md\n",
          "programs.md": "",
        })
      ).toEqual([
        'docs[0].file: https links only, found "http://anchor-lang.com" in idl.md',
        'docs[0].file: https links only, found "img/idl.png" in idl.md',
        'docs[0].file: https links only, found "http://solana.com" in idl.md',
        'docs[0].file: https links only, found "./programs.md" in idl.md',
      ]);
    });

    it("refuses a doc address that is not https", () => {
      const d = minimal();
      d.docs = [
        { title: "IDL", url: "http://anchor-lang.com", file: "idl.md" },
      ];
      expect(lines(d)).toEqual([
        'docs[0].url: text matching /^https:///, found "http://anchor-lang.com"',
      ]);
    });

    it("names a doc file listed twice, even with no folder to read", () => {
      const d = minimal();
      d.docs = [
        { title: "IDL", url: "https://a.dev/idl", file: "idl.md" },
        { title: "IDL again", url: "https://a.dev/idl2", file: "idl.md" },
      ];
      expect(lines(d)).toEqual([
        'docs[1].file: an id no other doc has, found "idl.md", also at docs[0].file',
      ]);
    });

    it("names both places of a step id used twice", () => {
      const d = minimal();
      d.steps[1].id = "program";
      expect(lines(d)).toEqual([
        'steps[1].id: an id no other step has, found "program", also at steps[0].id',
      ]);
    });

    it("names a created file the target lacks", () => {
      const d = minimal();
      (d.steps[0].beats[0] as WriteBeat).writes = {
        create: "client/client.ts",
      };
      expect(lines(d)).toEqual([
        'steps[0].beats[0].writes.create: a file in the step\'s target, found "client/client.ts"',
      ]);
    });

    it("needs a block's lines in a row", () => {
      const d = minimal();
      askAt(d, 1, 3).writes = {
        file: "src/lib.rs",
        block: "use anchor_lang::prelude::*;\nmsg!(name);",
      };
      expect(lines(d)).toEqual([
        'steps[1].beats[3].writes.block: a block in the step\'s target src/lib.rs, found "use anchor_lang::prelude::*;"',
      ]);
    });

    it("counts each schema error", () => {
      const d = minimal() as unknown as Record<string, unknown>;
      d.minutes = 0;
      d.level = "Expert";
      expect(lines(d)).toEqual([
        'level: one of "Beginner", "Intermediate", "Advanced", found "Expert"',
        "minutes: at least 1, found 0",
      ]);
    });
  });
}
