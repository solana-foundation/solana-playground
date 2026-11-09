import { existsSync, readdirSync, readFileSync } from "fs";
import { join, relative } from "path";
import ts from "typescript";
import { expect, it } from "vitest";

const SRC = join(__dirname, "..");
const LAYERS = ["features", "widgets"];

/** Slices with browser code: those with an `index.ts` */
const slices = () =>
  LAYERS.flatMap((layer) => {
    const root = join(SRC, layer);
    if (!existsSync(root)) return [];
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(layer, entry.name))
      .filter((slice) => existsSync(join(SRC, slice, "index.ts")));
  });

/** The event maps passed to `createTracker<...>()` in `file`, `null` for one that is not a type literal */
const eventMaps = (file: string) => {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true
  );

  const aliases = new Map<string, ts.TypeNode>();
  const maps: ts.TypeNode[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isTypeAliasDeclaration(node)) aliases.set(node.name.text, node.type);
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "createTracker" &&
      node.typeArguments?.[0]
    ) {
      maps.push(node.typeArguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  const resolve = (type: ts.TypeNode) =>
    ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName)
      ? aliases.get(type.typeName.text)
      : type;

  return {
    source,
    literals: maps.map((map) => {
      const literal = resolve(map);
      return literal && ts.isTypeLiteralNode(literal) ? literal : null;
    }),
  };
};

/** Names of the event-map keys passed to `createTracker<...>()` that have no doc comment */
const undocumentedEvents = (file: string): string[] => {
  const { source, literals } = eventMaps(file);
  const hasDocComment = (member: ts.Node) =>
    (ts.getLeadingCommentRanges(source.text, member.getFullStart()) ?? []).some(
      ({ pos, end }) => source.text.slice(pos, end).startsWith("/**")
    );
  return literals.flatMap((literal) =>
    literal
      ? literal.members
          .filter((member) => !hasDocComment(member))
          .map((member) => member.name?.getText(source) ?? "<unnamed>")
      : ["<map not found>"]
  );
};

/** The one browser module allowed to import the Sentry SDK; craco swaps it out of builds without Sentry */
const SENTRY_IMPORTER = join("shared", "lib", "reporter", "sentry.ts");

/** Every file under `dir`, as a path relative to `SRC` */
const filesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? filesUnder(join(dir, entry.name))
      : [relative(SRC, join(dir, entry.name))]
  );

/** Non-test source files under `src` that import `@sentry/react` */
const sentryImporters = () =>
  filesUnder(SRC)
    .filter((file) => /\.(tsx?|mjs)$/.test(file) && !/\.test\./.test(file))
    .filter((file) =>
      /from\s+["']@sentry\/react["']|import\(\s*["']@sentry\/react["']/.test(
        readFileSync(join(SRC, file), "utf8")
      )
    );

it("should import @sentry/react only from the reporter", () => {
  expect(sentryImporters()).toEqual([SENTRY_IMPORTER]);
});

it("should find the slices it checks", () => {
  expect(slices()).toContain(join("features", "auth"));
});

it.each(slices())(
  "should have %s declare its events in model/telemetry.ts",
  (slice) => {
    expect(existsSync(join(SRC, slice, "model", "telemetry.ts"))).toBe(true);
  }
);

it.each(slices())(
  "should have %s describe every event with a doc comment",
  (slice) => {
    const file = join(SRC, slice, "model", "telemetry.ts");
    if (!existsSync(file)) return;

    expect(undocumentedEvents(file)).toEqual([]);
  }
);

/** The tracker's own type tests, whose event maps are made up */
const TELEMETRY_LIB = join("shared", "lib", "telemetry");

/**
 * Every event name declared through `createTracker<...>()` in a non-test
 * source file anywhere under `src`: the slices and the legacy roots, whose
 * funnel steps the slice rule above never reached.
 */
let declared: Set<string> | undefined;
const declaredEvents = (): Set<string> =>
  (declared ??= new Set(
    filesUnder(SRC)
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\./.test(file))
      .filter((file) => !file.startsWith(TELEMETRY_LIB))
      .flatMap((file) => {
        const { source, literals } = eventMaps(join(SRC, file));
        return literals.flatMap((literal) =>
          (literal?.members ?? []).map(
            (member) => member.name?.getText(source) ?? ""
          )
        );
      })
  ));

/** The funnel table: the main spec once archived, the change's delta until then */
const FUNNEL_SPECS = [
  join("openspec", "specs", "client-v2-funnels", "spec.md"),
  join(
    "openspec",
    "changes",
    "funnel-events",
    "specs",
    "client-v2-funnels",
    "spec.md"
  ),
].map((path) => join(SRC, "..", "..", path));

interface FunnelRow {
  step: string;
  events: string[];
  failures: string[];
  /** The Failure events cell as written, for its `none: <why>` */
  failuresCell: string;
  source: string;
}

/** Backticked names in a table cell */
const namesIn = (cell: string) =>
  [...cell.matchAll(/`([a-z][a-z0-9_]*)`/g)].map((match) => match[1]);

/** The rows of the funnel table, whose header starts `| Step | Events | Failure events |` */
const funnelRows = (): FunnelRow[] => {
  const file = FUNNEL_SPECS.find((path) => existsSync(path));
  if (!file) return [];
  const lines = readFileSync(file, "utf8").split("\n");
  const header = lines.findIndex((line) =>
    /^\| Step \| Events \| Failure events \|/.test(line)
  );
  if (header === -1) return [];
  const rows: FunnelRow[] = [];
  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith("|")) break;
    const [step, events, failures, , source] = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    rows.push({
      step,
      events: namesIn(events),
      failures: namesIn(failures),
      failuresCell: failures,
      source,
    });
  }
  return rows;
};

/** A row whose events GA4 sends, or another change has yet to */
const isUntracked = (row: FunnelRow) =>
  row.source === "GA4" || row.source.startsWith("pending (");

it("should find the funnel table", () => {
  expect(funnelRows().length).toBeGreaterThanOrEqual(15);
});

it.each(funnelRows().map((row) => [row.step, row] as const))(
  "should declare every event the funnel step %s names",
  (_, row) => {
    if (isUntracked(row)) return;
    const declared = declaredEvents();
    expect(
      [...row.events, ...row.failures].filter((name) => !declared.has(name))
    ).toEqual([]);
  }
);

it.each(funnelRows().map((row) => [row.step, row] as const))(
  "should have the funnel step %s name how it fails",
  (_, row) => {
    expect(
      row.failures.length > 0 || row.failuresCell.startsWith("none:")
    ).toBe(true);
  }
);
