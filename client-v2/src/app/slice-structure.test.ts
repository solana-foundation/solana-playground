import { existsSync, readdirSync, readFileSync } from "fs";
import { join, relative } from "path";
import ts from "typescript";
// `@types/mocha` also declares a global `it`, without `each`
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

/** Names of the event-map keys passed to `createTracker<...>()` that have no doc comment */
const undocumentedEvents = (file: string): string[] => {
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
    if (!literal || !ts.isTypeLiteralNode(literal)) return ["<map not found>"];
    const hasDocComment = (member: ts.Node) =>
      (
        ts.getLeadingCommentRanges(source.text, member.getFullStart()) ?? []
      ).some(({ pos, end }) => source.text.slice(pos, end).startsWith("/**"));
    return literal.members
      .filter((member) => !hasDocComment(member))
      .map((member) => member.name?.getText(source) ?? "<unnamed>");
  });
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
