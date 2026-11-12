import { existsSync, readdirSync, readFileSync } from "fs";
import { dirname, join, relative } from "path";
import ts from "typescript";
import { beforeAll, describe, expect, it } from "vitest";

/*
 * The one cross-slice telemetry check. Each tracker's own parameters are
 * checked where it is declared, by the guards `createTracker` applies
 * (`shared/lib/telemetry/types.ts`): snake_case names, and values that are
 * numbers, booleans or string literals unless the slice opts into free text.
 * What no slice can see alone is a name two slices type differently: GA4
 * registers a custom dimension or metric by parameter name across all
 * events, so one name needs one type everywhere. This test reads every
 * tracker under `src` with the TypeScript compiler to find such names.
 */

const SRC = join(__dirname, "..");

type Kind = "string" | "number" | "boolean";

/** `type` is the kinds a parameter spells out, joined by `|` when one member mixes them */
type Usage = { event: string; type: string };

const filesUnder = (dir: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? filesUnder(join(dir, entry.name))
          : [join(dir, entry.name)]
      )
    : [];

/**
 * Every `.ts` and `.tsx` file under `src` that calls `createTracker<`, so a
 * tracker in a legacy root cannot escape. `shared/lib/telemetry` is left out on
 * purpose: `tracker.ts` and its tests hold in-source maps that are not events.
 */
const trackerFiles = (): string[] =>
  filesUnder(SRC).filter(
    (file) =>
      /\.tsx?$/.test(file) &&
      !/\.test\./.test(file) &&
      !relative(SRC, file).startsWith(join("shared", "lib", "telemetry")) &&
      /createTracker</.test(readFileSync(file, "utf8"))
  );

const FILES = trackerFiles();

/** The compiler's view of the app, so a parameter typed by an imported alias resolves */
const createProgram = (files: string[]) => {
  const configPath = join(SRC, "..", "tsconfig.json");
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    dirname(configPath)
  );
  // The ambient declarations (`FrameworkName` and the like) are imported by nobody
  const ambient = parsed.fileNames.filter((file) => file.endsWith(".d.ts"));
  return ts.createProgram(files.concat(ambient), parsed.options);
};

/** The kinds a type spells out: a union of string literals is `string` */
const kindsOf = (type: ts.Type): Kind[] => {
  if (type.isUnion()) return type.types.flatMap(kindsOf);
  if (type.flags & (ts.TypeFlags.String | ts.TypeFlags.StringLiteral)) {
    return ["string"];
  }
  if (type.flags & (ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral)) {
    return ["number"];
  }
  if (type.flags & (ts.TypeFlags.Boolean | ts.TypeFlags.BooleanLiteral)) {
    return ["boolean"];
  }
  // `undefined` from an optional member is not a second type
  if (type.flags & ts.TypeFlags.Undefined) return [];
  throw new Error(`type flags ${String(type.flags)} are not a primitive`);
};

/**
 * Every parameter name under the trackers: name -> one usage per event that
 * sends it, with the type that event declares. An event whose parameters are a
 * union sends the parameters of every branch.
 */
const collectUsages = (files: string[]): Map<string, Usage[]> => {
  const program = createProgram(files);
  const checker = program.getTypeChecker();
  const found = new Map<string, Usage[]>();
  for (const file of files) {
    const source = program.getSourceFile(file);
    if (!source) throw new Error(`${file} is not in the program`);
    const visit = (node: ts.Node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "createTracker" &&
        node.typeArguments?.[0]
      ) {
        const map = checker.getTypeFromTypeNode(node.typeArguments[0]);
        for (const event of map.getProperties()) {
          const params = checker.getTypeOfSymbol(event);
          const branches = params.isUnion() ? params.types : [params];
          // `NoParams` has no properties
          const kinds = new Map<string, Set<Kind>>();
          for (const param of branches.flatMap((branch) =>
            branch.getProperties()
          )) {
            let spelled: Kind[];
            try {
              spelled = kindsOf(checker.getTypeOfSymbol(param));
            } catch (error) {
              throw new Error(
                `${event.name}.${param.name} in ${relative(
                  SRC,
                  file
                )}: ${String(error)}; did its alias resolve?`
              );
            }
            const seen = kinds.get(param.name) ?? new Set<Kind>();
            spelled.forEach((kind) => seen.add(kind));
            kinds.set(param.name, seen);
          }
          kinds.forEach((seen, name) => {
            const usage: Usage = {
              event: event.name,
              type: Array.from(seen).sort().join("|"),
            };
            found.set(name, (found.get(name) ?? []).concat(usage));
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return found;
};

/** The kinds a name is declared with across its usages, sorted */
const kindsOfName = (usages: Usage[]) =>
  Array.from(new Set(usages.flatMap(({ type }) => type.split("|")))).sort();

/**
 * Names that carry two types, each with why it stays. GA4 registers a name
 * once, so each is a defect awaiting its fix, and an entry leaves this list in
 * the change that fixes it: the test fails on an entry that no longer
 * conflicts. Empty since HOO-2752 renamed `step` and `from` and made
 * `feedback_sent.rating` a number only, absent when no star is given.
 */
const KNOWN_CONFLICTS: Record<string, string> = {};

/**
 * The one name for what the user pressed, or where an action started. `from`
 * and `source` said the same thing until HOO-2752; a new parameter that says it
 * is `via`. A name only the cross-slice scan can hold to, since each slice
 * would accept a synonym of its own. The open changes `funnel-events` and
 * `wbdi-flow` still spell `from` or `source` for events nobody sends yet, and
 * bring them to `via` in their own PRs; this test refuses them the moment a
 * tracker declares them.
 */
const TRIGGER = "via";
const TRIGGER_SYNONYMS = ["from", "source"];

describe("telemetry parameters", () => {
  let parameters = new Map<string, Usage[]>();

  // Building the program takes seconds, so a failure reports once, not per test
  beforeAll(() => {
    parameters = collectUsages(FILES);
  }, 120_000);

  // These floors guard a scan that finds nothing without failing when the scan
  // breaks or a tracker's type stops resolving: today 82 names.
  it("finds the parameters of every tracker", () => {
    expect(FILES.length).toBeGreaterThan(25);
    expect(parameters.size).toBeGreaterThan(50);
  });

  it("gives every parameter name one type, except the listed conflicts", () => {
    const conflicts = Array.from(parameters)
      .filter(([, usages]) => kindsOfName(usages).length > 1)
      .map(
        ([name, usages]) =>
          `${name}: ${usages
            .map(({ event, type }) => `${event}=${type}`)
            .join(", ")}`
      );
    const known = Object.keys(KNOWN_CONFLICTS);
    expect(
      conflicts.filter((line) => !known.includes(line.split(":")[0]))
    ).toEqual([]);
    expect(
      known.filter(
        (name) => !conflicts.some((line) => line.startsWith(`${name}:`))
      )
    ).toEqual([]);
  });

  it("names a trigger `via`, never a synonym", () => {
    expect(parameters.has(TRIGGER)).toBe(true);
    expect(TRIGGER_SYNONYMS.filter((name) => parameters.has(name))).toEqual([]);
  });
});
