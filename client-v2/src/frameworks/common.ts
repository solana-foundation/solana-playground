import { z } from "zod";

import { createLogger } from "../shared/lib/logger";
import {
  JsRuntimePackageName,
  MergeUnion,
  PgCommon,
  PgExplorer,
  PgLanguage,
  PgProgramInfo,
  PgView,
  PgWeb3,
  TupleFiles,
  ValueOf,
} from "../utils";
import { SelectProgram } from "./SelectProgram";

const log = createLogger("frameworks:export");

/** The project an export converts: its name, its program keypair and id */
export interface ExportedProject {
  name: string | undefined;
  /** The program keypair, absent when the project has none */
  kp: PgWeb3.Keypair | undefined;
  /** The program id, absent when the project has none */
  pk: PgWeb3.PublicKey | undefined;
}

/** What an export reads of a saved project's `.workspace/program-info.json` */
const SavedProgramInfo = z.object({
  kp: z.array(z.number().int()).length(64).nullish(),
  customPk: z.string().nullish(),
});

/**
 * Read the project an export converts. The open one's program is the one in
 * memory, whose file may not be written yet; another project's is its saved
 * program info. The Projects menu exports any project, and the open one's
 * keypair in another's zip would give it the open one's program id.
 *
 * @param name the project; the open one when not given
 * @returns its name, program keypair and program id, each absent when it has none
 */
export const readExportedProject = async (
  name: string | undefined
): Promise<ExportedProject> => {
  if (!name || name === PgExplorer.currentWorkspaceName) {
    return {
      name: name ?? PgExplorer.currentWorkspaceName,
      kp: PgProgramInfo.kp ?? undefined,
      pk: PgProgramInfo.pk ?? undefined,
    };
  }

  const path = PgCommon.joinPaths(
    PgExplorer.PATHS.ROOT_DIR_PATH,
    name,
    PgExplorer.PATHS.WORKSPACE_DIRNAME,
    "program-info.json"
  );
  try {
    const saved = SavedProgramInfo.parse(await PgExplorer.fs.readToJSON(path));
    const kp = saved.kp
      ? PgWeb3.Keypair.fromSecretKey(Uint8Array.from(saved.kp))
      : undefined;
    const pk = saved.customPk
      ? new PgWeb3.PublicKey(saved.customPk)
      : kp?.publicKey;
    return { name, kp, pk };
  } catch (e) {
    // The export goes without a program id rather than with a wrong one. A
    // project never built has no program info, the ordinary case; any other
    // failure says why, naming the kind of failure but no part of the file,
    // which holds the program's secret key
    const error = e as { code?: string; message?: string } | undefined;
    const isMissing =
      error?.code === "ENOENT" || !!error?.message?.includes("ENOENT");
    if (!isMissing) {
      log.warn(
        `Exporting "${name}" without its program id: its program info is ${
          e instanceof z.ZodError ? "malformed" : "unreadable"
        }`
      );
    }
    return { name, kp: undefined, pk: undefined };
  }
};

/** Map of dependency name -> version */
type Dependencies = { [dependencyName: string]: string };

/**
 * Add the given content after the regular expression.
 *
 * @param content original content
 * @param afterRegex add after this regular expression
 * @param newContent new content to add
 * @param opts options
 * - `firstOccurance`: Add after the first occurance of the regex(defaults to last)
 * @returns the content with the new content added
 */
export const addAfter = (
  content: string,
  afterRegex: RegExp,
  newContent: string,
  opts?: { firstOccurance?: boolean }
) => {
  const occuranceIndex = opts?.firstOccurance ? 0 : -1;
  const match = PgCommon.matchAll(content, afterRegex).at(occuranceIndex);
  const afterStartIndex = (match?.index ?? 0) + (match?.at(0)?.length ?? 0) + 1;
  content =
    content.slice(0, afterStartIndex) +
    newContent +
    "\n" +
    content.slice(afterStartIndex);

  return content;
};

/**
 * Wrap everything after the leading imports in an async function that is
 * called right away whenever the word `await` appears, because top-level
 * `await` is not available in a CommonJS module.
 *
 * An `await` inside a comment or a string also triggers the wrap, which is
 * harmless. A client with a top-level `export` (`export const`, `export {}`,
 * `export *`) is left as it is: inside the function the `export` would not
 * compile. A line inside a template literal or a block comment that starts
 * with `export` also leaves the client unwrapped.
 *
 * @param content JS/TS code
 * @returns the content with the wrapped code
 */
export const wrapTopLevelAwait = (content: string) => {
  if (!/\bawait\b/.test(content) || /^export\b/m.test(content)) {
    return content;
  }

  const bodyStartIndex = getLeadingImportsEnd(content);

  // The body is not re-indented: indenting lines inside a multi-line template
  // literal would change its text
  const body = content.slice(bodyStartIndex).trim();

  return (
    content.slice(0, bodyStartIndex) +
    `\n\n(async () => {\n${body}\n})().catch((err) => {\n  console.error(err);\n  process.exitCode = 1;\n});\n`
  );
};

/**
 * Get the index where the run of import statements at the top of the file
 * ends, where comments and blank lines may sit between the statements.
 * Searching the whole file would find the word "import" in a comment of the
 * code below the imports.
 *
 * @param content JS/TS code
 * @returns the index after the last leading import, `0` if there is none
 */
const getLeadingImportsEnd = (content: string) => {
  const skipped = /(?:\s|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*/y;
  // `import{BN}`, `import*as x` and `import"x"` need no space after the keyword;
  // a lookahead keeps `important` and `import(` out
  const importStatement = /import(?=[\s{*"'])[\s\S]*?["'][^"'\n]*["'];?/y;
  let end = 0;
  let index = 0;
  while (true) {
    skipped.lastIndex = index;
    index += skipped.exec(content)?.[0].length ?? 0;
    importStatement.lastIndex = index;
    if (!importStatement.exec(content)) return end;
    index = end = importStatement.lastIndex;
  }
};

/**
 * Add the given code on the lines after the leading imports.
 *
 * @param content JS/TS code
 * @param newContent code to add
 * @returns the content with the code added
 */
export const addAfterImports = (content: string, newContent: string) => {
  const end = getLeadingImportsEnd(content);
  if (!end) return newContent + "\n" + content;

  // A comment on the last import's line stays beside that import
  const comment = /^[ \t]*\/\/[^\r\n]*/.exec(content.slice(end))?.[0] ?? "";
  const head = end + comment.length;
  // Skip the line break that ends the last import, when there is one
  const rest = content.slice(head).replace(/^\r?\n/, "");
  return content.slice(0, head) + "\n" + newContent + "\n" + rest;
};

/**
 * Get `Cargo.toml` dependencies from the given files.
 *
 * @param files all files
 * @returns the dependency list
 */
export const getRustDependencies = async (files: TupleFiles) => {
  const versions = await getVersions("crates");
  // Without them, `spl-token-2022` exports a second `entrypoint` and `init_if_needed` does not compile
  const features = await fetchCrateFeatures();
  // Exact: a bare "1.1.2" lets Cargo take a later 1.x than the server builds with
  const getVersion = (crateName: string) =>
    versions[crateName] ? `"=${versions[crateName]}"` : `"*"`;
  const getRequirement = (crateName: string) => {
    const crateFeatures = features[crateName];
    if (!crateFeatures) return getVersion(crateName);
    const list = crateFeatures.map((feature) => `"${feature}"`).join(", ");
    return `{ version = ${getVersion(crateName)}, features = [${list}] }`;
  };

  const dependencies: Dependencies = {};
  const rustContents = files
    .filter(([path]) => path.endsWith(".rs"))
    .map(([, content]) => content);

  for (const content of rustContents) {
    for (const crateName of CRATES.importable) {
      const dependencyName = PgCommon.toKebabFromSnake(crateName);
      if (
        !dependencies[dependencyName] &&
        new RegExp(`${crateName}::`, "gm").test(content)
      ) {
        dependencies[dependencyName] = getRequirement(dependencyName);
      }
    }
  }

  return Object.entries(dependencies).reduce((acc, [name, requirement]) => {
    return acc + `\n${name} = ${requirement}`;
  }, "[dependencies]");
};

const CRATE_FEATURES_PATH = "/crates/features.json";

const isCrateFeatures = (value: unknown): value is Record<string, string[]> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every(
    (features) =>
      Array.isArray(features) &&
      features.every((feature) => typeof feature === "string")
  );

/**
 * Fetch the features `generate-crates.mjs` serves for each crate.
 *
 * @throws if the file is not served or is not a map of crate name to feature list
 */
const fetchCrateFeatures = async () => {
  const features: unknown = JSON.parse(
    await PgCommon.fetchText(CRATE_FEATURES_PATH)
  );
  if (!isCrateFeatures(features)) {
    throw new Error(
      `${CRATE_FEATURES_PATH} is not a map of crate name to feature list`
    );
  }
  return features;
};

/**
 * Fetch the build server's `Cargo.lock`, which `generate-crates.mjs` serves beside the crates. The exports ship it,
 * since the manifest pins only the crates the source names and the lock also holds the server's transitive versions.
 *
 * @throws if the file is not served
 */
export const fetchServerCargoLock = () =>
  PgCommon.fetchText("/crates/Cargo.lock");

/**
 * Get the packages the given files import or use as Playground globals, with
 * the versions the Playground runs.
 *
 * @param files all files
 * @returns a map of package name to version, `*` when the version is unknown
 */
export const fetchJSDependencyMap = async (files: TupleFiles) => {
  const versions = await getVersions("packages");
  const getVersion = (packageName: string) => versions[packageName] ?? "*";

  const dependencies: Dependencies = {};
  const jsContents = files
    .filter(([path]) => PgLanguage.getIsPathJsLike(path))
    .map(([, content]) => content);

  for (const content of jsContents) {
    // Importables
    for (const packageName of PACKAGES.importable) {
      if (
        !dependencies[packageName] &&
        new RegExp(`("|')${packageName}("|')`, "gm").test(content)
      ) {
        dependencies[packageName] = getVersion(packageName);
      }
    }

    // Globals
    for (const packageName of Object.keys(getGlobalPackages(content))) {
      dependencies[packageName] = getVersion(packageName);
    }
  }

  return dependencies;
};

/**
 * Get `package.json` dependencies from the given files.
 *
 * @param files all files
 * @returns the dependency list
 */
export const getJSDependencies = async (files: TupleFiles) => {
  const dependencies = await fetchJSDependencyMap(files);
  const devDependencies: Dependencies = {
    "@types/bn.js": "^5.1.1",
    "@types/chai": "^4.3.5",
    "@types/mocha": "^10.0.1",
    "@types/node": "^20.0.0",
    chai: "^4.3.8",
    mocha: "^10.2.0",
    prettier: "^3.0.2",
    "ts-mocha": "^10.0.0",
    "ts-node": "^10.9.1",
    typescript: "^5.2.2",
  };

  return PgCommon.prettyJSON({ dependencies, devDependencies }).slice(2, -2);
};

/**
 * Get a map of names to versions.
 *
 * @param kind `crates` or `packages`
 * @returns versions map
 */
const getVersions = async (
  kind: "crates" | "packages"
): Promise<Record<string, string>> => {
  return await PgCommon.fetchJSON(`/${kind}/versions.json`);
};

/**
 * Add imports for files that use Playground globals.
 *
 * @param content JS/TS code
 * @returns the content with the added imports
 */
export const addImports = (content: string) => {
  // Remove the "No imports needed:..." comment
  const noImportsStartIndex = content.indexOf("// No imports needed");
  if (noImportsStartIndex !== -1) {
    const noImportsEndIndex =
      noImportsStartIndex + content.slice(noImportsStartIndex).indexOf("\n");
    content =
      content.slice(0, noImportsStartIndex) +
      content.slice(noImportsEndIndex + 1);
  }

  // Add imports for Playground globals
  const globalPackages = getGlobalPackages(content);
  for (const [packageName, importStyle] of Object.entries(globalPackages)) {
    const style = importStyle as Partial<MergeUnion<typeof importStyle>>;
    const importStyleText = style.as
      ? `* as ${style.as}`
      : style.named
      ? `{ ${style.named} }`
      : style.default;
    content = `import ${importStyleText} from "${packageName}";\n` + content;
  }

  return content;
};

/**
 * Names the import statements of the given code bind: `web3` for
 * `import * as web3 from "x"`, `import web3 from "x"` and `import{web3}from"x"`,
 * `b` for `import { a as b } from "x"`. A name the code already binds must not
 * be imported again, which would not compile.
 *
 * @param content JS/TS code
 * @returns the bound names
 */
export const getImportedNames = (content: string) => {
  const names = new Set<string>();
  // An import in a comment or a string binds nothing: drop comments and empty
  // strings, read together so "http://" in a string is not taken for a
  // comment; an import's own `from "x"` stays a string, `from ""`
  const code = content.replace(
    /("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (_match, string?: string) => (string ? string[0] + string[0] : " ")
  );
  // A statement starts a line or follows a `;`, after any whitespace (`\s`
  // includes a byte order mark)
  const statement =
    /(?:^|;)\s*import(?![\w$(])([^"'`;]*?)\bfrom\s*["'][^"'\n]*["']/gm;
  for (const [, clause] of code.matchAll(statement)) {
    for (const part of clause.replace(/[{}]/g, ",").split(",")) {
      const name = part
        .trim()
        .split(/\s+as\s+|\*\s*as\s+/)
        .pop()
        ?.trim();
      if (name && /^[\w$]+$/.test(name) && name !== "type") names.add(name);
    }
  }
  return names;
};

/**
 * Get global packages that are used in the given content.
 *
 * @param content JS/TS code
 * @returns a map of package name to import style
 */
const getGlobalPackages = (content: string) => {
  const packages: Record<string, ValueOf<typeof PACKAGES["global"]>> = {};
  const imported = getImportedNames(content);
  for (const [_packageName, importStyle] of PgCommon.entries(PACKAGES.global)) {
    if (PACKAGES_MAP[_packageName] === null) continue;
    const packageName = PACKAGES_MAP[_packageName] ?? _packageName;

    const style = importStyle as Partial<MergeUnion<typeof importStyle>>;
    const name = style.as ?? style.named ?? style.default;
    // `web3.` also matches inside "@solana/web3.js", so a client that binds
    // the name itself would get it twice
    if (name !== undefined && imported.has(name)) continue;

    const accessors = [name + ".", name + "("];
    for (const accessor of accessors) {
      if (!packages[packageName] && content.includes(accessor)) {
        packages[packageName] = importStyle;
      }
    }
  }

  return packages;
};

/** Map packages to a different package on exports or completely ignore them */
const PACKAGES_MAP: {
  [K in JsRuntimePackageName]?: JsRuntimePackageName | null;
} = {
  buffer: null, // No need to import
};

/**
 * Show select program modal.
 *
 * @param programNames program names to select from
 * @throws if the user cancels the selection
 * @returns the selected program name
 */
export const selectProgram = async (programNames: string[]) => {
  const programName: string | null = await PgView.setModal(SelectProgram, {
    programNames,
  });
  if (!programName) throw new Error("Program not selected");

  return programName;
};

/**
 * Convert the given `files` to playground layout.
 *
 * @param files files with the framework layout
 * @returns the files with playground layout
 */
export const convertToPlaygroundCommon = (files: TupleFiles) => {
  const pgFiles: TupleFiles = [];
  for (const [path, content] of files) {
    // */programs/*/src/**/*.rs -> src/**/*.rs
    const programPathResult = /(src)(?!.*src\/).*\.rs$/.exec(path);
    if (programPathResult) {
      const programFilePath = programPathResult[0];
      pgFiles.push([programFilePath, content]);
      continue;
    }

    // */client/**/*.ts -> client/**/*.ts
    const clientPathResult = /(client)(?!.*client\/).*\.(js|ts)$/.exec(path);
    if (clientPathResult) {
      const clientFilePath = clientPathResult[0];
      pgFiles.push([clientFilePath, content]);
      continue;
    }

    // */tests/**/*.ts -> tests/**/*.test.ts
    const testPathResult = /(tests)(?!.*tests\/).*\.(js|ts)$/.exec(path);
    if (testPathResult) {
      const testPath = testPathResult[0].replace(
        /(\.test)?\.(js|ts)$/,
        ".test.ts"
      );
      pgFiles.push([testPath, content]);
      continue;
    }
  }

  return pgFiles;
};
