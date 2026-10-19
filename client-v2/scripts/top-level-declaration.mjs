import ts from "typescript";

const DECLARATIONS = new Set([
  ts.SyntaxKind.VariableStatement,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ClassDeclaration,
]);

/** The first name a script declares at its top level, or `null` if it declares none */
export const topLevelName = (text, fileName = "chunk.js") => {
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
