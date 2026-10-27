/**
 * Local ESLint rules for `src/`'s layers, loaded through the `link:`
 * dependency in `package.json`: eslintrc loads a rule only from a plugin
 * package. See client-v2/CLAUDE.md, Layers.
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
    const filename = context.getFilename();
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
      const delimiter = context.getSourceCode().getText(node)[0];
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

module.exports = {
  rules: {
    "alias-across-modules": aliasAcrossModules,
    // `boundaries/dependencies` under a second id: eslintrc gives a rule id one
    // severity, and `eslint-layers.js` needs the recorded exception at "warn"
    "recorded-exception": require("eslint-plugin-boundaries").rules
      .dependencies,
  },
};
