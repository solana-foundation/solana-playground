import type { CompilerOptions } from "typescript";
import {
  flattenDiagnosticMessageText,
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
 * `import` statements of project code: `* as name`, `{ a, b as c }`, a
 * default name, or none (side effect only)
 */
const IMPORT_REGEX =
  /import\s+(?:((\*\s+as\s+(\w+))|({[\s+\w+\s+,]*})|(\w+))\s+from\s+)?["|'](.+)["|']/gm;

/**
 * Rewrites each `import` into an awaited `__pgImport(path)`, which the
 * sandbox answers with its own copy of the package (`sandbox/runtime.ts`).
 *
 * @param code project code
 * @returns the code without `import` statements
 */
const rewriteImports = (code: string) =>
  code.replace(
    IMPORT_REGEX,
    // eslint-disable-next-line max-params -- `String.replace` hands every capture group
    (_match, _clause, _ns, namespace, named, defaultName, path) => {
      const imported = `await __pgImport(${JSON.stringify(path)})`;
      if (namespace) return `const ${namespace} = ${imported};`;
      if (named) {
        const bindings = (named as string)
          .slice(1, -1)
          .split(",")
          .map((binding) => binding.trim())
          .filter(Boolean)
          .map((binding) => {
            const [name, , alias] = binding.split(/\s+/);
            return alias ? `${name}: ${alias}` : name;
          });
        return `const { ${bindings.join(", ")} } = ${imported};`;
      }
      if (defaultName) {
        return `const ${defaultName} = ((m) => m.default ?? m)(${imported});`;
      }
      return `${imported};`;
    }
  );

/** Lines the wrapper in `prepareCode` puts before the project's first line */
const WRAPPER_LINES = 2;

/**
 * Turns project code into what the sandbox runs: imports rewritten, wrapped
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
  class __Pg { async __run() {\n${rewriteImports(code)}\n} }
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
