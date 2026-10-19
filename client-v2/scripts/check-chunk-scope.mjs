// Chunks load as classic scripts: a top-level declaration becomes a global that a later chunk overwrites
import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

const DECLARATIONS = new Set([
  ts.SyntaxKind.VariableStatement,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ClassDeclaration,
]);

/** The first name a top-level statement declares, or `null` if it declares none */
const topLevelName = (text, fileName = "chunk.js") => {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.JS
  );
  const statement = source.statements.find((s) => DECLARATIONS.has(s.kind));
  if (!statement) return null;
  const node = ts.isVariableStatement(statement)
    ? statement.declarationList.declarations[0]
    : statement;
  return node.name?.getText(source) ?? "(anonymous)";
};

const jsFiles = async (dir) => {
  const entries = await fs.readdir(dir, {
    recursive: true,
    withFileTypes: true,
  });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".js"))
    .map((e) => path.join(e.parentPath, e.name));
};

const main = async () => {
  const dir = process.argv[2] ?? "build/static/js";
  const files = await jsFiles(dir);
  if (!files.length) {
    console.error(`::error::no .js files under ${dir}: run the build first`);
    process.exit(1);
  }

  let failed = false;
  for (const file of files) {
    const name = topLevelName(await fs.readFile(file, "utf8"), file);
    if (name) {
      failed = true;
      console.error(
        `::error::${file} declares \`${name}\` at the top level: the minifier's iife wrapper is missing (format in craco.config.js)`
      );
    }
  }
  if (failed) process.exit(1);
  console.log(`${files.length} chunks declare nothing at the top level`);
};

await main();
