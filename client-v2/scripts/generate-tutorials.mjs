// Generate tutorial data.

import { execSync } from "child_process";
import { existsSync } from "fs";
import fs from "fs/promises";
import pathModule from "path";

import { CLIENT_PATH } from "./utils.mjs";

/** Tutorials public directory path */
const TUTORIALS_PATH = pathModule.join(CLIENT_PATH, "public", "tutorials");

// The folder exists only while `src/tutorials/markdown-tutorials.json` enables a tutorial
const tutorials = existsSync(TUTORIALS_PATH)
  ? await fs.readdir(TUTORIALS_PATH)
  : [];
for (const name of tutorials) {
  const tutorialPath = pathModule.join(TUTORIALS_PATH, name);
  const dir = await fs.readdir(tutorialPath);
  const isMarkdownTutorial = dir.includes("data.json");
  if (!isMarkdownTutorial) continue;

  // Get file paths
  const recursivelFindFiles = async (dirPath) => {
    const files = [];
    const entries = await fs.readdir(dirPath);
    for (const entry of entries) {
      const path = pathModule.join(dirPath, entry);
      const stat = await fs.lstat(path);
      if (stat.isFile()) {
        files.push(path.replace(filesDirPath + pathModule.sep, ""));
      } else if (stat.isDirectory()) {
        files.push(...(await recursivelFindFiles(path)));
      }
    }

    return files;
  };
  const filesDirPath = pathModule.join(tutorialPath, "files");
  const files = await recursivelFindFiles(filesDirPath);

  await fs.writeFile(
    pathModule.join(tutorialPath, "content.json"),
    JSON.stringify({ files })
  );
}

/**
 * An object key as prettier writes it (`quoteProps: "as-needed"`): bare when
 * it is an identifier (`lumberjack`), quoted otherwise (`"hello-anchor"`)
 */
const keyOf = (name) =>
  /^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name);

// Conversation tutorial definitions: one static import of every
// `src/tutorials/<slug>/tutorial.json` and of each Markdown page in its
// `docs/` folder, so a new folder needs no code. The loader
// (`src/tutorials/definitions.ts`) checks each at runtime.
const DEFINITIONS_PATH = pathModule.join(CLIENT_PATH, "src", "tutorials");
const DEFINITION = "tutorial.json";
const DOCS = "docs";

// The browser suite's own doc pages (`playwright.config.mts` sets this): a
// tutorial that lists no docs of its own gets the pages and the list in
// `__tests__/docs/<slug>/`, so the doc tabs stay tested should its own list
// go; a tutorial with pages of its own keeps them. Every other run, and
// every build, leaves the test pages out, and every run writes the module
// anew, so a build never carries the pages an e2e run put there
const TEST_DOCS = process.env.TUTORIAL_TEST_DOCS === "1";
const TEST_DOCS_PATH = pathModule.join(DEFINITIONS_PATH, "__tests__", DOCS);
const definitionSlugs = (
  await fs.readdir(DEFINITIONS_PATH, { withFileTypes: true })
)
  .filter((entry) => entry.isDirectory() && !/^[_.]/.test(entry.name))
  .map((entry) => entry.name)
  .filter((slug) =>
    existsSync(pathModule.join(DEFINITIONS_PATH, slug, DEFINITION))
  )
  .sort();

/**
 * When the folder's first file was added, for the catalog's `unixTimestamp`
 * (which nothing sorts by yet): now for a folder git does not know, and now,
 * with a warning, where git cannot answer (no repository in a build image)
 */
const addedAt = (dir) => {
  const now = Math.floor(Date.now() / 1000);
  try {
    const dates = execSync(
      "git log --follow --format=%ad --date=unix --diff-filter=A .",
      { cwd: dir, stdio: ["ignore", "pipe", "ignore"] }
    )
      .toString()
      .split("\n")
      .filter(Boolean);
    return Number(dates.pop() ?? now);
  } catch (e) {
    console.warn(`${dir}: no git history (${e.message}), dated now`);
    return now;
  }
};

const imports = [];
const entries = [];
/** The slugs given the test pages, said in the module and on the console */
const testedSlugs = [];
/** The `from` clause of an import line, which orders the lines by path */
const fromOf = (line) => line.slice(line.indexOf('from "'));
for (const [i, slug] of definitionSlugs.entries()) {
  const dir = pathModule.join(DEFINITIONS_PATH, slug);
  let thumbnail;
  let listed;
  try {
    ({ thumbnail, docs: listed } = JSON.parse(
      await fs.readFile(pathModule.join(dir, DEFINITION), "utf8")
    ));
  } catch (e) {
    // `yarn tutorial:check` names the problem; here it only stops the build
    throw new Error(`${slug}/${DEFINITION}: not JSON, ${e.message}`);
  }
  imports.push(`import d${i} from "../${slug}/${DEFINITION}";`);
  // A thumbnail next to the definition is bundled; a path or URL is kept
  const bundled =
    typeof thumbnail === "string" &&
    existsSync(pathModule.join(dir, thumbnail));
  if (bundled) imports.push(`import t${i} from "../${slug}/${thumbnail}";`);
  const testDocs = pathModule.join(TEST_DOCS_PATH, slug);
  const isTested =
    TEST_DOCS &&
    !listed?.length &&
    existsSync(pathModule.join(testDocs, "docs.json"));
  if (isTested) {
    testedSlugs.push(slug);
    imports.push(`import l${i} from "../__tests__/${DOCS}/${slug}/docs.json";`);
  }
  // Every page in `docs/`, as webpack's raw text: the check finds a listed
  // page that is missing, and the doc tab renders the rest
  const docsDir = isTested ? testDocs : pathModule.join(dir, DOCS);
  const docsFrom = isTested
    ? `../__tests__/${DOCS}/${slug}`
    : `../${slug}/${DOCS}`;
  const pages = existsSync(docsDir)
    ? (await fs.readdir(docsDir, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .map((entry) => entry.name)
        .sort()
    : [];
  pages.forEach((page, j) =>
    imports.push(`import m${i}_${j} from "${docsFrom}/${page}";`)
  );
  // One property a line, as prettier keeps an object written that way
  const docs = pages.length
    ? [
        "{",
        ...pages.map((page, j) => `      ${keyOf(page)}: m${i}_${j},`),
        "    }",
      ].join("\n")
    : "{}";
  entries.push(
    [
      `  ${keyOf(slug)}: {`,
      isTested ? `    json: { ...d${i}, docs: l${i} },` : `    json: d${i},`,
      `    thumbnail: ${bundled ? `t${i}` : "undefined"},`,
      `    docPages: ${docs},`,
      `    unixTimestamp: ${addedAt(dir)},`,
      "  },",
    ].join("\n")
  );
}

// `_` keeps the folder out of the slugs, the check and the exports
await fs.mkdir(pathModule.join(DEFINITIONS_PATH, "_definitions"), {
  recursive: true,
});
await fs.writeFile(
  pathModule.join(DEFINITIONS_PATH, "_definitions", "generated.ts"),
  [
    "// Generated by scripts/generate-tutorials.mjs; do not edit.",
    ...(testedSlugs.length
      ? [`// TUTORIAL_TEST_DOCS: test doc pages for ${testedSlugs.join(", ")}`]
      : []),
    // In path order, as the lint's import sort wants them
    ...imports.sort((a, b) => fromOf(a).localeCompare(fromOf(b))),
    "",
    "/** Every definition file by slug, unchecked */",
    "export const DEFINITION_FILES: Record<",
    "  string,",
    "  {",
    "    json: unknown;",
    "    thumbnail: string | undefined;",
    "    /** The Markdown pages in the tutorial's `docs/` folder, by file name */",
    "    docPages: Readonly<Record<string, string>>;",
    "    unixTimestamp: number;",
    "  }",
    "> = {",
    ...entries,
    "};",
    "",
  ].join("\n")
);

if (TEST_DOCS) {
  // A test folder for no tutorial at all is a typo or a leftover; one for a
  // tutorial with docs of its own is unused on purpose
  const unused = existsSync(TEST_DOCS_PATH)
    ? (await fs.readdir(TEST_DOCS_PATH, { withFileTypes: true }))
        .filter((e) => e.isDirectory() && !definitionSlugs.includes(e.name))
        .map((e) => e.name)
    : [];
  if (testedSlugs.length) {
    console.warn(
      `TUTORIAL_TEST_DOCS: test doc pages for ${testedSlugs.join(", ")}`
    );
  }
  if (unused.length) {
    console.warn(
      `TUTORIAL_TEST_DOCS: test doc pages for no tutorial: ${unused.join(", ")}`
    );
  }
}
