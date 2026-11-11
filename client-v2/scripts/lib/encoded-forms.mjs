// The forms a secret value takes once written into a file, shared by the
// build scan (`scripts/public-env.mjs`) and the commit check
// (`scripts/check-env-leaks.mjs`). No dependencies, so the pre-commit hook
// runs in a checkout without `node_modules`.

/**
 * `value` as written; inside a double-quoted JS or JSON string (quotes,
 * backslashes and newlines escaped, as a multiline private key would be),
 * with `/` escaped too, as some serialisers write it; and inside a
 * single-quoted string, which esbuild writes for a string that holds `"`.
 *
 * @param {string} value
 * @returns {string[]}
 */
export const encodedForms = (value) => {
  const escaped = JSON.stringify(value).slice(1, -1);
  const singleQuoted = escaped.replaceAll('\\"', '"').replaceAll("'", "\\'");
  return [
    ...new Set([value, escaped, escaped.replaceAll("/", "\\/"), singleQuoted]),
  ];
};
