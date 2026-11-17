/**
 * Parse the given input to tokens.
 *
 * @param input command input
 * @returns the parsed tokens
 */
export const parse = (input: string) => tokenize(input).tokens;

/**
 * Parse the given input to the tokens a command runs with: a run of spaces
 * separates as one space does, and only a quoted empty string is an empty token.
 */
export const parseArgs = (input: string) => {
  const { tokens, quotedIndices } = tokenize(input);
  return tokens.filter((token, i) => token !== "" || quotedIndices.has(i));
};

/** Autocomplete reads the empty token each unquoted space starts, so {@link parse} keeps them. */
const tokenize = (input: string) => {
  const tokens = [];
  const quotedIndices = new Set<number>();
  let currentTokenIndex = 0;
  let isInQuotes = false;
  for (const char of input) {
    switch (char) {
      case '"':
      case "'":
        isInQuotes = !isInQuotes;
        quotedIndices.add(currentTokenIndex);
        if (!tokens[currentTokenIndex]) tokens[currentTokenIndex] = "";
        break;

      case " ":
        if (!isInQuotes) {
          currentTokenIndex++;
          tokens[currentTokenIndex] = "";
        } else {
          if (!tokens[currentTokenIndex]) tokens[currentTokenIndex] = char;
          else tokens[currentTokenIndex] += char;
        }
        break;

      default:
        if (!tokens[currentTokenIndex]) tokens[currentTokenIndex] = char;
        else tokens[currentTokenIndex] += char;
    }
  }

  return { tokens, quotedIndices };
};

/**
 * @returns whether the given token is a command option
 */
export const getIsOption = (token: string) => token.startsWith("-");

/**
 * Get the closest *left* word boundary of the given input at the given offset.
 */
export const closestLeftBoundary = (input: string, offset: number) => {
  const found = getWordBoundaries(input, true)
    .reverse()
    .find((x) => x < offset);
  return found === undefined ? 0 : found;
};

/**
 * Get the closest *right* word boundary of the given input at the given offset.
 */
export const closestRightBoundary = (input: string, offset: number) => {
  const found = getWordBoundaries(input, false).find((x) => x > offset);
  return found === undefined ? input.length : found;
};

/** Get all the word boundaries from the given input. */
const getWordBoundaries = (input: string, leftSide: boolean = true) => {
  let match;
  const words = [];
  const regex = /\w+/g;

  match = regex.exec(input);
  while (match) {
    if (leftSide) words.push(match.index);
    else words.push(match.index + match[0].length);

    match = regex.exec(input);
  }

  return words;
};

/**
 * Checks if there is an incomplete input
 *
 * An incomplete input is considered:
 * - An input that contains unterminated single quotes
 * - An input that contains unterminated double quotes
 * - An input that ends with "\"
 * - An input that has an incomplete boolean shell expression (&& and ||)
 * - An incomplete pipe expression (|)
 */
export const isIncompleteInput = (input: string) => {
  // Empty input is not incomplete
  if (input.trim() === "") {
    return false;
  }

  // Check for dangling single-quote strings
  if ((input.match(/'/g) || []).length % 2 !== 0) {
    return true;
  }
  // Check for dangling double-quote strings
  if ((input.match(/"/g) || []).length % 2 !== 0) {
    return true;
  }
  // Check for dangling boolean or pipe operations
  if ((input.split(/(\|\||\||&&)/g).pop() as string).trim() === "") {
    return true;
  }
  // Check for tailing slash
  if (input.endsWith("\\") && !input.endsWith("\\\\")) {
    return true;
  }

  return false;
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("utils/terminal/utils", () => {
    it("parseArgs reads two spaces between an argument and an option as one", () => {
      expect(parseArgs("anchor idl init PROGRAM  --filepath idl.json")).toEqual(
        parseArgs("anchor idl init PROGRAM --filepath idl.json")
      );
    });

    it("parseArgs adds no argument for leading or trailing spaces", () => {
      expect(parseArgs("  anchor idl  ")).toEqual(["anchor", "idl"]);
    });

    it("parseArgs keeps a quoted empty string as an argument", () => {
      expect(parseArgs(`echo "" ''`)).toEqual(["echo", "", ""]);
    });
  });
}
