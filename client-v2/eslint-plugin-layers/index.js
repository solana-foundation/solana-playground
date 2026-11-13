/**
 * Local ESLint rules for `src/`'s layers, loaded through the `link:`
 * dependency in `package.json`. See client-v2/CLAUDE.md, Layers.
 */

const fs = require("fs");
const path = require("path");

const LAYERS = new Set(["app", "widgets", "features", "entities", "shared"]);

/** `.mjs` is exempt: plain Node runs it and cannot resolve `@/` */
const CHECKED_FILE = /\.(tsx?|mts)$/;

const RELATIVE = /^\.\.?(\/|$)/;

/** `vi` calls whose first argument is a module path, resolved like an import */
const VI_PATH_CALLS = new Set([
  "mock",
  "doMock",
  "unmock",
  "doUnmock",
  "importActual",
  "importMock",
]);

class InvalidSrcError extends Error {
  name = "InvalidSrcError";
}

const isDirectory = (file) =>
  fs.statSync(file, { throwIfNoEntry: false })?.isDirectory() ?? false;

/** Source directories already checked, so a lint run stats each once */
const checkedSrc = new Set();

const assertSrc = (src) => {
  if (checkedSrc.has(src)) return;
  if (!path.isAbsolute(src) || !isDirectory(src)) {
    throw new InvalidSrcError(
      `layers/alias-across-modules: "src" must be an absolute path to an existing directory, got "${src}"`
    );
  }
  checkedSrc.add(src);
};

/**
 * The module `file` belongs to: a slice, or a first-level folder of a layer;
 * a file at the top of a layer belongs to the layer. `null` outside the layers.
 */
const moduleOf = (src, file) => {
  const segments = path.relative(src, file).split(path.sep);
  if (!LAYERS.has(segments[0])) return null;
  // An extensionless `app/Effects` names a module only when it is a folder
  const inFolder =
    segments.length > 2 || (segments.length === 2 && isDirectory(file));
  return inFolder ? segments.slice(0, 2).join("/") : segments[0];
};

/** The module path a node spells, or `null` when it is not a constant string */
const specifierOf = (node) => {
  if (node?.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0].value.cooked;
  }
  return null;
};

/** `text` written back inside `delimiter`, escaped so the fix stays the same string */
const escapeFor = (text, delimiter) =>
  delimiter === "`"
    ? text.replace(/\\|`|\$\{/g, (match) => `\\${match}`)
    : text.replace(/\\/g, "\\\\").replaceAll(delimiter, `\\${delimiter}`);

const aliasAcrossModules = {
  meta: {
    type: "suggestion",
    fixable: "code",
    docs: {
      description:
        "Require `@/` for an import that leaves its module in src/'s layers",
    },
    schema: {
      type: "array",
      minItems: 1,
      maxItems: 1,
      items: [
        {
          type: "object",
          properties: { src: { type: "string" } },
          required: ["src"],
          additionalProperties: false,
        },
      ],
    },
    messages: {
      alias:
        '{{to}} is outside this module ({{from}}): write it as "{{alias}}". See client-v2/CLAUDE.md, Layers',
    },
  },
  create(context) {
    const { src } = context.options[0];
    assertSrc(src);
    const filename = context.filename;
    if (!CHECKED_FILE.test(filename)) return {};
    const from = moduleOf(src, filename);
    if (!from) return {};

    const check = (node) => {
      const specifier = specifierOf(node);
      if (specifier === null || !RELATIVE.test(specifier)) return;
      const target = path.resolve(path.dirname(filename), specifier);
      const to = moduleOf(src, target);
      if (!to || to === from) return;
      const alias = `@/${path.relative(src, target).split(path.sep).join("/")}`;
      const delimiter = context.sourceCode.getText(node)[0];
      context.report({
        node,
        messageId: "alias",
        data: { from, to, alias },
        fix: (fixer) =>
          fixer.replaceText(
            node,
            delimiter + escapeFor(alias, delimiter) + delimiter
          ),
      });
    };

    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
      TSExternalModuleReference: (node) => check(node.expression),
      // typescript-estree 5 names it `parameter`; 6 renamed it `argument`
      TSImportType: (node) => check((node.argument ?? node.parameter)?.literal),
      CallExpression(node) {
        const { callee } = node;
        const isRequire =
          callee.type === "Identifier" && callee.name === "require";
        const isViPathCall =
          callee.type === "MemberExpression" &&
          callee.object.type === "Identifier" &&
          callee.object.name === "vi" &&
          VI_PATH_CALLS.has(callee.property.name);
        if (isRequire || isViPathCall) check(node.arguments[0]);
      },
    };
  },
};

/** Test files by the names vitest, `node --test` and Playwright collect */
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

/** Playwright's folder: its helpers are test code without a test file name */
const E2E_DIR = path.join(__dirname, "..", "e2e") + path.sep;

/** `if (import.meta.vitest)`, the guard of an in-source test block */
const isInSourceGuard = (node) =>
  node.type === "IfStatement" &&
  node.test.type === "MemberExpression" &&
  node.test.object.type === "MetaProperty" &&
  node.test.object.meta.name === "import" &&
  node.test.property.name === "vitest";

const noTestSpread = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Disallow a spread that builds a new object or array shape in test code",
    },
    schema: [],
    messages: {
      spread:
        'Name every field of the new shape instead of spreading: a spread hides which fields the fixture carries. See client-v2/AGENTS.md, "Tests: no spread for creating new shapes"',
    },
  },
  create(context) {
    const filename = context.filename;
    const isTestFile = TEST_FILE.test(filename) || filename.startsWith(E2E_DIR);

    return {
      SpreadElement(node) {
        const { parent } = node;
        if (
          parent.type !== "ObjectExpression" &&
          parent.type !== "ArrayExpression"
        ) {
          return;
        }
        const inBlock = context.sourceCode
          .getAncestors(node)
          .some(
            (ancestor) =>
              isInSourceGuard(ancestor) &&
              ancestor.consequent.range[0] <= node.range[0] &&
              node.range[1] <= ancestor.consequent.range[1]
          );
        if (isTestFile || inBlock) {
          context.report({ node, messageId: "spread" });
        }
      },
    };
  },
};

/** `api/` handlers have the signature the platform defines */
const API_DIR = path.join(__dirname, "..", "api") + path.sep;

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

const OPTIONS_NAMES = new Set(["options", "opts", "config", "settings"]);

/** A component's name: an uppercase first letter and at least one lowercase letter */
const PASCAL_CASE = /^[A-Z](?=.*[a-z])[A-Za-z0-9]*$/;

/** The name a function is declared or assigned under, when it has one */
const nameOf = (fn) => {
  if (fn.id) return fn.id.name;
  const { parent } = fn;
  const target =
    (parent.type === "VariableDeclarator" && parent.id) ||
    (parent.type === "AssignmentExpression" && parent.left) ||
    ((parent.type === "Property" ||
      parent.type === "MethodDefinition" ||
      parent.type === "PropertyDefinition") &&
      parent.key);
  if (!target) return undefined;
  if (target.type === "Identifier") return target.name;
  if (target.type === "MemberExpression") return target.property.name;
  return undefined;
};

/** The parameter itself: a constructor's `private x?: T` wraps it */
const unwrap = (param) =>
  param.type === "TSParameterProperty" ? param.parameter : param;

/** The binding a defaulted parameter assigns to */
const bindingOf = (param) =>
  param.type === "AssignmentPattern" ? param.left : param;

const curryOrder = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Require curried parameters: no defaults or optional parameters, the fixed values first, the data last",
    },
    schema: [],
    messages: {
      optional:
        '"{{name}}" is optional or has a default: pre-apply it instead (`truncate = truncateWith(80)`). See client-v2/CLAUDE.md, "Curried parameters"',
      callbackLast:
        'Callback "{{name}}" comes last: a callback stays fixed between calls, so it goes first. See client-v2/CLAUDE.md, "Curried parameters"',
      optionsLast:
        '"{{name}}" comes last: configuration stays fixed between calls, so curry it first (`<verb>With(config)(data)`). See client-v2/CLAUDE.md, "Curried parameters"',
    },
  },
  create(context) {
    if (context.filename.startsWith(API_DIR)) return {};
    const isExempt = (fn) => {
      const { parent } = fn;
      const isCallArgument =
        (parent.type === "CallExpression" || parent.type === "NewExpression") &&
        parent.arguments.includes(fn);
      const name = nameOf(fn);
      return isCallArgument || (name !== undefined && PASCAL_CASE.test(name));
    };

    const checkParams = (fn) => {
      if (isExempt(fn)) return;
      for (const param of fn.params.map(unwrap)) {
        const binding = bindingOf(param);
        if (param.type === "AssignmentPattern" || binding.optional === true) {
          context.report({
            node: param,
            messageId: "optional",
            data: { name: binding.name ?? "parameter" },
          });
        }
      }
      if (fn.params.length < 2) return;
      const last = bindingOf(unwrap(fn.params[fn.params.length - 1]));
      if (last.typeAnnotation?.typeAnnotation?.type === "TSFunctionType") {
        context.report({
          node: last,
          messageId: "callbackLast",
          data: { name: last.name },
        });
      } else if (last.type === "Identifier" && OPTIONS_NAMES.has(last.name)) {
        context.report({
          node: last,
          messageId: "optionsLast",
          data: { name: last.name },
        });
      }
    };

    return Object.fromEntries(
      [...FUNCTION_TYPES].map((type) => [type, checkParams])
    );
  },
};

module.exports = {
  rules: {
    "alias-across-modules": aliasAcrossModules,
    "curry-order": curryOrder,
    "no-test-spread": noTestSpread,
    // `boundaries/dependencies` under a second id: a rule id has one severity
    // per file, and `eslint-layers.js` needs the recorded exception at "warn"
    "recorded-exception": require("eslint-plugin-boundaries").rules
      .dependencies,
  },
};
