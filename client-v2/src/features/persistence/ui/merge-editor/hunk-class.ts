import type { LineLook } from "./merge-file";

/**
 * The class Monaco puts on a hunk's lines, or on lines a side changed on its
 * own.
 *
 * The element's own classes cannot go on a decoration: Monaco cleans a
 * decoration's class name to letters, digits, `-` and `_`, which turns
 * `bg-error/12` into the solid `bg-error`. So each look has a plain name,
 * and `index.css` gives it `mergeHunkVariants`' classes with `@apply`;
 * `hunk-class.test.ts` fails if the two stop matching.
 */
export const hunkLineClass = (look: LineLook) => `pg-merge-hunk-${look}`;
