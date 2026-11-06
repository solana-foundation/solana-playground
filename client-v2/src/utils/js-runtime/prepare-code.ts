import type {
  CompilerOptions,
  ImportDeclaration,
  StringLiteral,
} from "typescript";
import {
  createSourceFile,
  flattenDiagnosticMessageText,
  isImportDeclaration,
  isNamespaceImport,
  ScriptKind,
  ScriptTarget,
  transpileModule,
} from "typescript";

/**
 * How project code is transpiled. ES2020, not ES5: ES5 turns `for...of` over
 * a `Map` or `Set` into an index loop that reads `.length` and silently runs
 * zero times, and Kit's own examples iterate maps.
 */
const TRANSPILE_OPTIONS: CompilerOptions = {
  target: ScriptTarget.ES2020,
  removeComments: true,
};

/** Globals project code must not reach, hidden behind its wrapper's parameters */
const HIDDEN_GLOBALS = ["eval", "Function"];

/**
 * What an import declaration becomes: its package, awaited from the sandbox
 * (`__pgImport`, answered with the sandbox's own copy, `sandbox/runtime.ts`),
 * bound to the names it imports. A type-only import binds nothing at run time
 * and becomes nothing.
 *
 * @param index the declaration's place among the code's imports, which names
 * its module's binding
 * @returns a function of the declaration
 */
const importedFor = (index: number) => (declaration: ImportDeclaration) => {
  const path = (declaration.moduleSpecifier as StringLiteral).text;
  const imported = `await __pgImport(${JSON.stringify(path)})`;
  const clause = declaration.importClause;
  if (!clause) return `${imported};`;
  if (clause.isTypeOnly) return "";
  const module = `__pgModule${index}`;
  const statements = [`const ${module} = ${imported};`];
  if (clause.name) {
    statements.push(
      `const ${clause.name.text} = ${module}.default ?? ${module};`
    );
  }
  const bindings = clause.namedBindings;
  if (bindings && isNamespaceImport(bindings)) {
    statements.push(`const ${bindings.name.text} = ${module};`);
  } else if (bindings) {
    const names = bindings.elements
      .filter((element) => !element.isTypeOnly)
      .map((element) =>
        element.propertyName
          ? `${element.propertyName.text}: ${element.name.text}`
          : element.name.text
      );
    if (names.length)
      statements.push(`const { ${names.join(", ")} } = ${module};`);
  }
  return statements.join(" ");
};

/**
 * Moves every import declaration to the start of the code, as `importedFor`
 * rewrites it, so each is loaded before any statement runs, as ES modules
 * load theirs. Declarations are found by TypeScript's parser, so an `import`
 * in a comment or a string is left alone and a comment before one does not
 * hide it. The rewritten imports go on the first line and each declaration
 * leaves its line breaks behind, so the code's line numbers stay as written.
 *
 * @param code project code
 * @returns the code with its imports first
 */
const hoistImports = (code: string) => {
  const source = createSourceFile(
    "project.ts",
    code,
    ScriptTarget.ES2020,
    true,
    ScriptKind.TS
  );
  const declarations = source.statements.filter(isImportDeclaration);
  if (!declarations.length) return code;
  const hoisted = declarations.map((declaration, index) =>
    importedFor(index)(declaration)
  );
  let rest = code;
  // From the last, so earlier positions stay valid
  for (const declaration of [...declarations].reverse()) {
    const start = declaration.getStart(source);
    const text = rest.slice(start, declaration.end);
    rest =
      rest.slice(0, start) +
      "\n".repeat(text.split("\n").length - 1) +
      rest.slice(declaration.end);
  }
  return `${hoisted.join(" ")} ${rest}`;
};

/** Lines the wrapper in `prepareCode` puts before the project's first line */
const WRAPPER_LINES = 2;

/**
 * Turns project code into what the sandbox runs: imports moved to the start
 * (`hoistImports`), wrapped
 * so top-level `await` works and `this` is not the window, handed to
 * `__pgDone` so the sandbox knows when it ends, and transpiled to JavaScript.
 * The class body makes the code strict; `eval` and `Function` are shadowed
 * by the outer function's parameters, since assigning to them in strict
 * code is a syntax error.
 *
 * Transpiling stays in the page, so the sandbox's bundle carries no
 * TypeScript compiler.
 *
 * @param code project code (TypeScript or JavaScript)
 * @returns JavaScript for `new Function` in the sandbox
 * @throws {SyntaxError} on the first syntax error, which TypeScript's error
 * recovery would otherwise turn into code that runs
 */
export const prepareCode = (code: string) => {
  const { outputText, diagnostics } = transpileModule(
    `__pgDone((async function (${HIDDEN_GLOBALS.join(", ")}) {
  class __Pg { async __run() {\n${hoistImports(code)}\n} }
  await new __Pg().__run();
})());`,
    { compilerOptions: TRANSPILE_OPTIONS, reportDiagnostics: true }
  );

  const [first] = diagnostics ?? [];
  if (first) {
    const message = flattenDiagnosticMessageText(first.messageText, "\n");
    const position =
      first.file && first.start !== undefined
        ? first.file.getLineAndCharacterOfPosition(first.start)
        : undefined;
    throw new SyntaxError(
      position
        ? `Line ${position.line + 1 - WRAPPER_LINES}: ${message}`
        : message
    );
  }

  return outputText;
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("utils/js-runtime/prepare-code", () => {
    /** Runs prepared code with stand-ins for the sandbox's two names */
    const runPrepared = async (
      code: string,
      packages: Record<string, unknown>
    ) => {
      let finished: Promise<unknown> = Promise.resolve();
      const seen: unknown[] = [];
      // eslint-disable-next-line no-new-func -- runs the prepared code as the sandbox does
      new Function("__pgImport", "__pgDone", "seen", prepareCode(code))(
        async (path: string) => packages[path],
        (promise: Promise<unknown>) => {
          finished = promise;
        },
        seen
      );
      await finished;
      return seen;
    };

    it("resolves namespace, named, renamed and default imports through __pgImport", async () => {
      const seen = await runPrepared(
        [
          'import * as ns from "a";',
          "import { one, two as second } from 'b';",
          'import def from "c";',
          'import plain from "d";',
          "seen.push(ns.x, one, second, def, plain.y);",
        ].join("\n"),
        {
          a: { x: 1 },
          b: { one: 2, two: 3 },
          c: { default: 4 },
          d: { y: 5 },
        }
      );
      expect(seen).toEqual([1, 2, 3, 4, 5]);
    });

    it("loads every import before the code runs, wherever it is written", async () => {
      const seen = await runPrepared(
        'seen.push(ns.x);\nimport * as ns from "a";',
        { a: { x: 1 } }
      );
      expect(seen).toEqual([1]);
    });

    it("loads two imports on one line", async () => {
      const seen = await runPrepared(
        'import * as a from "a"; import * as b from "b";\nseen.push(a.x, b.x);',
        { a: { x: 1 }, b: { x: 2 } }
      );
      expect(seen).toEqual([1, 2]);
    });

    it("loads an import that a block comment precedes on its line", async () => {
      const seen = await runPrepared(
        '/* note */ import * as a from "a";\nseen.push(a.x);',
        { a: { x: 1 } }
      );
      expect(seen).toEqual([1]);
    });

    it("binds a default and named imports from one declaration, and drops a type-only one", async () => {
      const seen = await runPrepared(
        'import type { T } from "t";\nimport def, { one } from "c";\nseen.push(def, one);',
        { c: { default: 4, one: 1 } }
      );
      expect(seen).toEqual([4, 1]);
    });

    it("leaves an import in a comment where it is, unrun", () => {
      expect(
        prepareCode('// import * as gone from "missing";\nconst a = 1;')
      ).not.toContain("__pgImport");
    });

    it("keeps the code's line numbers with its imports moved", () => {
      expect(() =>
        prepareCode('const a = 1;\nimport * as ns from "a";\nconst x = ;')
      ).toThrow(/^Line 3: /);
    });

    it("runs TypeScript with top-level await", async () => {
      const seen = await runPrepared(
        "const n: number = await Promise.resolve(7);\nseen.push(n);",
        {}
      );
      expect(seen).toEqual([7]);
    });

    it("throws a SyntaxError naming the line, where TypeScript would recover", () => {
      expect(() => prepareCode('const a = 1;\nconsole.log("a" "b");')).toThrow(
        /^Line 2: ',' expected\.$/
      );
      expect(() => prepareCode("const a = 1;\nconst x = ;")).toThrow(
        SyntaxError
      );
    });

    it("keeps for...of over a Map, BigInt literals and numeric separators", async () => {
      const seen = await runPrepared(
        'for (const [k] of new Map([["a", 1]])) seen.push(k);\nseen.push(1_000n * 2n);',
        {}
      );
      expect(seen).toEqual(["a", 2000n]);
    });

    it("hides eval and Function from the code", async () => {
      const seen = await runPrepared(
        "seen.push(typeof eval, typeof Function);",
        {}
      );
      expect(seen).toEqual(["undefined", "undefined"]);
    });

    it("runs the code as strict code", async () => {
      await expect(runPrepared("undeclared = 1;", {})).rejects.toThrow(
        /undeclared/
      );
    });

    it("rejects the done promise with the code's error", async () => {
      await expect(runPrepared('throw new Error("boom");', {})).rejects.toThrow(
        "boom"
      );
    });
  });
}
