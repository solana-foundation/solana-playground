// Chunks load as classic scripts: a top-level declaration becomes a global that a later chunk overwrites
import assert from "node:assert/strict";
import test from "node:test";
import TerserPlugin from "terser-webpack-plugin";
import ts from "typescript";

import { esbuildMinifyOptions } from "./esbuild-minify.mjs";

// A named class and function, so keepNames emits its helpers
const CHUNK =
  "(self.webpackChunksolpg=self.webpackChunksolpg||[]).push([[1],{1:(m)=>{class _PgProbe{} function probe(){} m.exports={_PgProbe,probe}}}]);";

const DECLARATIONS = new Set([
  ts.SyntaxKind.VariableStatement,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ClassDeclaration,
]);

/** The first name a top-level statement declares, or `null` if it declares none */
const topLevelName = (text) => {
  const source = ts.createSourceFile(
    "chunk.js",
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

const minify = async (options) => {
  const { code } = await TerserPlugin.esbuildMinify(
    { "chunk.js": CHUNK },
    undefined,
    options
  );
  return code;
};

test("the minifier options leave nothing declared at a chunk's top level", async () => {
  const options = esbuildMinifyOptions();
  // Without the wrapper the fixture must declare, or the assertion below passes on any options
  const unwrapped = await minify({
    keepNames: options.keepNames,
    target: options.target,
  });
  assert.notEqual(
    topLevelName(unwrapped),
    null,
    `the fixture no longer declares at the top level without format:\n${unwrapped}`
  );

  const code = await minify(options);
  const name = topLevelName(code);
  assert.equal(
    name,
    null,
    `the minified chunk declares \`${name}\` at the top level: the iife wrapper is missing (format in esbuild-minify.mjs)\n${code}`
  );
});
