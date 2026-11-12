import { existsSync, readdirSync, readFileSync } from "fs";
import { join, relative } from "path";
import ts from "typescript";
import { expect, it } from "vitest";

const SRC = join(__dirname, "..");
const LAYERS = ["features", "widgets"];
/** Layers whose trackers the funnel table may name */
/**
 * Where the funnel check scans for `createTracker<...>()` maps. `entities` is
 * here because `entities/tutorial` declares the tutorial events; `LAYERS`
 * leaves it out because the slice checks cover only slices with browser code.
 */
const TRACKER_LAYERS = ["features", "widgets", "entities"];
const REPO = join(SRC, "..", "..");

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

/** The event-map keys passed to `createTracker<...>()` in `file`, and whether each has a doc comment */
const trackerEvents = (
  file: string
): { name: string; documented: boolean }[] => {
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

  return maps.flatMap((map) => {
    const literal = resolve(map);
    if (!literal || !ts.isTypeLiteralNode(literal))
      return [{ name: "<map not found>", documented: false }];
    const hasDocComment = (member: ts.Node) =>
      (
        ts.getLeadingCommentRanges(source.text, member.getFullStart()) ?? []
      ).some(({ pos, end }) => source.text.slice(pos, end).startsWith("/**"));
    return literal.members.map((member) => ({
      name: member.name?.getText(source) ?? "<unnamed>",
      documented: hasDocComment(member),
    }));
  });
};

/** Names of the event-map keys passed to `createTracker<...>()` that have no doc comment */
const undocumentedEvents = (file: string): string[] =>
  trackerEvents(file)
    .filter((event) => !event.documented)
    .map((event) => event.name);

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

/** Every event name a tracker declares under `features/`, `widgets/` or `entities/` */
const declaredEvents = () =>
  new Set(
    TRACKER_LAYERS.flatMap((layer) =>
      existsSync(join(SRC, layer)) ? filesUnder(join(SRC, layer)) : []
    )
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\./.test(file))
      .flatMap((file) => trackerEvents(join(SRC, file)))
      .map((event) => event.name)
      .filter((name) => !name.startsWith("<"))
  );

/** The funnel table: the main spec, or the `funnel-events` delta while the main spec does not exist */
const funnelSpec = () => {
  const main = join(REPO, "openspec", "specs", "client-v2-funnels", "spec.md");
  return existsSync(main)
    ? main
    : join(
        REPO,
        "openspec",
        "changes",
        "funnel-events",
        "specs",
        "client-v2-funnels",
        "spec.md"
      );
};

/** The table that starts at the `Events` header: its header cells and each row's cells, ending at the first line that is not a table row */
const funnelTable = () => {
  const lines = readFileSync(funnelSpec(), "utf8").split("\n");
  const start = lines.findIndex(
    (line) => line.startsWith("|") && /\bEvents\b/.test(line)
  );
  if (start < 0) return { header: [], rows: [] };
  const end = lines.findIndex(
    (line, index) => index > start && !line.startsWith("|")
  );
  const cells = lines
    .slice(start, end < 0 ? undefined : end)
    .map((line) => line.split(/(?<!\\)\|/).map((cell) => cell.trim()));
  return {
    header: cells[0],
    rows: cells.slice(1).filter((row) => !/^:?-+:?$/.test(row[1])),
  };
};

/** Each row of the funnel table: the backticked names of its Events column and its Source */
const funnelRows = () => {
  const { header, rows } = funnelTable();
  const events = header.indexOf("Events");
  const source = header.indexOf("Source");
  return rows.map((cells) => ({
    events: Array.from(cells[events].matchAll(/`([^`]+)`/g), (m) => m[1]),
    source: cells[source],
  }));
};

/** Rows that are neither GA4 nor pending, so a tracker must declare their events */
const checkedRows = () =>
  funnelTable().rows.filter((cells) => {
    const source = cells[funnelTable().header.indexOf("Source")];
    return source !== "GA4" && !source.startsWith("pending (");
  });

it("should read the funnel table", () => {
  const { header } = funnelTable();
  expect(header, "the funnel table needs an Events column").toContain("Events");
  expect(header, "the funnel table needs a Source column").toContain("Source");
  expect(funnelRows()).toContainEqual({
    events: ["auth_signed_in"],
    source: "features/auth",
  });
  expect(declaredEvents()).toContain("auth_signed_in");
});

it("should have a tracker declare every funnel event that is not GA4 or pending", () => {
  const declared = declaredEvents();
  const missing = funnelRows()
    .filter(({ source }) => source !== "GA4" && !source.startsWith("pending ("))
    .flatMap(({ events }) => events)
    .filter((event) => !declared.has(event));

  expect(missing).toEqual([]);
});

it("should name every funnel event that is not GA4 or pending in backticks", () => {
  const events = funnelTable().header.indexOf("Events");
  const unnamed = checkedRows()
    .filter((cells) => cells[events] !== "" && !/`[^`]+`/.test(cells[events]))
    .map((cells) => cells[events]);

  expect(unnamed).toEqual([]);
});
