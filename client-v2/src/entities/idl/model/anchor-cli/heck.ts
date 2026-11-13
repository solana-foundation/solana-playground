// The `heck` crate's cases as Anchor 1.1.2 applies them: version 0.3.3 in the IDL converter, version 0.4.1 without its `unicode` feature in the CLI

const isLowercase = (char: string) => /\p{Lowercase}/u.test(char);
const isUppercase = (char: string) => /\p{Uppercase}/u.test(char);

type WordMode = "boundary" | "lowercase" | "uppercase";

/** The case of the last cased character, `char` included */
const modeAfter = (mode: WordMode, char: string): WordMode => {
  if (isLowercase(char)) return "lowercase";
  return isUppercase(char) ? "uppercase" : mode;
};

/**
 * heck's `transform` over one word: cuts at each `_`, before a capital that
 * follows a lowercase letter, and before the last capital of a run that a
 * lowercase letter follows.
 */
const splitWord = (word: string): string[] => {
  const chars = Array.from(word);
  const parts: string[] = [];
  let start = 0;
  let mode: WordMode = "boundary";
  for (let i = 0; i < chars.length; i += 1) {
    const char = chars[i];
    if (char === "_") {
      if (start === i) start += 1;
      continue;
    }
    if (i + 1 === chars.length) {
      parts.push(chars.slice(start).join(""));
      break;
    }
    const next = chars[i + 1];
    const nextMode = modeAfter(mode, char);
    if (next === "_" || (nextMode === "lowercase" && isUppercase(next))) {
      parts.push(chars.slice(start, i + 1).join(""));
      start = i + 1;
      mode = "boundary";
    } else if (mode === "uppercase" && isUppercase(char) && isLowercase(next)) {
      parts.push(chars.slice(start, i).join(""));
      start = i;
      mode = "boundary";
    } else {
      mode = nextMode;
    }
  }
  return parts;
};

/** heck's `lowercase`: a capital sigma that ends the word takes its final form */
const lowercase = (word: string) => {
  const chars = Array.from(word);
  return chars
    .map((char, i) =>
      char === "Σ" && i === chars.length - 1 ? "ς" : char.toLowerCase()
    )
    .join("");
};

const capitalize = (word: string) => {
  const [first, ...rest] = Array.from(word);
  return first === undefined
    ? ""
    : first.toUpperCase() + lowercase(rest.join(""));
};

/**
 * `unicode_words` of the `unicode-segmentation` crate, exact for ASCII text:
 * letters, digits, and `_` join, a letter joins the next letter across one of
 * `:.'`, and a digit joins the next digit across one of `,;.'`.
 */
const UNICODE_WORD =
  /(?:\p{L}\p{M}*(?:[:.'](?=\p{L}))?|\p{Nd}\p{M}*(?:[,;.'](?=\p{Nd}))?|_)+/gu;

const unicodeWords = (text: string) =>
  (text.match(UNICODE_WORD) ?? []).filter((word) => /[^_]/.test(word));

/** heck 0.4.1 without `unicode`: every character but an ASCII letter or digit separates words */
const asciiWords = (text: string) => text.split(/[^A-Za-z0-9]/);

const camel = (words: string[]) =>
  words
    .map((word, i) => (i === 0 ? lowercase(word) : capitalize(word)))
    .join("");

/** `to_snake_case` of heck 0.3.3 */
export const heckSnakeCase = (text: string) =>
  unicodeWords(text).flatMap(splitWord).map(lowercase).join("_");

/** `to_mixed_case` of heck 0.3.3 */
export const heckMixedCase = (text: string) =>
  camel(unicodeWords(text).flatMap(splitWord));

/** `to_lower_camel_case` of heck 0.4.1 */
export const heckLowerCamelCase = (text: string) =>
  camel(asciiWords(text).flatMap(splitWord));

/** `to_pascal_case` of heck 0.4.1 */
export const heckPascalCase = (text: string) =>
  asciiWords(text).flatMap(splitWord).map(capitalize).join("");
