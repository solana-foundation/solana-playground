// Check conversation tutorial definitions: `yarn tutorial:check [<slug> | <dir>]`.
//
// With no argument it checks every `src/tutorials/<slug>/tutorial.json`
// (folders starting with `_` or `.` aside). Each error prints as its JSON
// path, what was expected and what was found; any error, a file that is not
// JSON, or finding no definition at all exits with code 1. A definition's
// docs are read from its `docs/` folder.

import fs from "fs";
import path from "path";

import {
  checkDefinition,
  formatError,
  slugOf,
} from "../src/entities/tutorial/model/definition/check";
import {
  isOnStartLadder,
  START_LADDER,
} from "../src/entities/tutorial/model/start-ladder";

const CLIENT = path.join(__dirname, "..");
const TUTORIALS = path.join(CLIENT, "src", "tutorials");
const DEFINITION = "tutorial.json";
const DOCS = "docs";

const folders = (dir: string) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !/^[_.]/.test(e.name))
        .map((e) => e.name)
    : [];

const holds = (dir: string, test: Parameters<string[]["some"]>[0]) =>
  fs.readdirSync(dir).some(test);

/** The Markdown tutorials `src/tutorials/markdown-tutorials.json` enables, tracked in `public/` */
const PUBLIC = path.join(CLIENT, "public", "tutorials");

/**
 * Every tutorial a definition's `next` may name, by slug, as the app's
 * catalog (`src/tutorials/definitions.ts`) reads them: definitions and custom
 * tutorials by folder, Markdown tutorials by the slug of their name
 */
const known = new Set([
  ...folders(TUTORIALS).filter((slug) =>
    holds(
      path.join(TUTORIALS, slug),
      (name) => name === DEFINITION || name.startsWith("index.")
    )
  ),
  ...folders(PUBLIC)
    .map((slug) => path.join(PUBLIC, slug, "data.json"))
    .filter((file) => fs.existsSync(file))
    .map((file) => slugOf(JSON.parse(fs.readFileSync(file, "utf8")).name)),
]);

/** The Markdown in a tutorial's `docs/` folder, by file name */
const docsOf = (dir: string): Record<string, string> => {
  const docs = path.join(dir, DOCS);
  if (!fs.existsSync(docs)) return {};
  return Object.fromEntries(
    fs
      .readdirSync(docs, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => [e.name, fs.readFileSync(path.join(docs, e.name), "utf8")])
  );
};

/** The folders to check, from the argument */
const targets = (arg: string | undefined): string[] => {
  if (arg === undefined) {
    const all = folders(TUTORIALS)
      .map((slug) => path.join(TUTORIALS, slug))
      .filter((dir) => fs.existsSync(path.join(dir, DEFINITION)));
    if (all.length === 0) {
      console.error(
        `no ${DEFINITION} under ${path.relative(CLIENT, TUTORIALS)}`
      );
      process.exit(1);
    }
    return all;
  }
  const dir = fs.existsSync(arg)
    ? path.resolve(arg)
    : path.join(TUTORIALS, arg);
  if (!fs.existsSync(path.join(dir, DEFINITION))) {
    console.error(`${arg}: no ${DEFINITION} in ${path.relative(CLIENT, dir)}`);
    process.exit(1);
  }
  return [dir];
};

/**
 * A `finish.next` that names a tutorial off the start ladder: a finish
 * recommends only the tutorials walked through end to end
 */
const offLadder = (json: unknown) => {
  const next = (json as { finish?: { next?: unknown } } | null)?.finish?.next;
  if (typeof next !== "string" || isOnStartLadder(next)) return [];
  const ladder = START_LADDER.map((l) => slugOf(l.name)).join(", ");
  return [
    {
      path: "finish.next",
      message: `a tutorial of the start ladder (${ladder}), found ${JSON.stringify(
        next
      )}`,
    },
  ];
};

let failed = 0;
for (const dir of targets(process.argv[2])) {
  const slug = path.basename(dir);
  let json: unknown;
  try {
    json = JSON.parse(fs.readFileSync(path.join(dir, DEFINITION), "utf8"));
  } catch (e) {
    console.log(`${slug}/${DEFINITION}: not JSON, ${(e as Error).message}`);
    failed++;
    continue;
  }
  const errors = checkDefinition(json, known, {
    slug,
    docs: docsOf(dir),
  }).concat(offLadder(json));
  if (errors.length === 0) {
    console.log(`${slug}: ok`);
    continue;
  }
  failed++;
  console.log(
    `${slug}: ${errors.length} error${errors.length === 1 ? "" : "s"}`
  );
  for (const error of errors) console.log(formatError(error));
}
process.exit(failed === 0 ? 0 : 1);
