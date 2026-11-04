/**
 * Narrows a value a test needs to be there, in place of a non-null assertion
 * (`value!`): a missing value fails the test with what was missing, not with
 * a `TypeError` some lines later.
 *
 * `requireFor("the panel's bounding box")(await panel.boundingBox())`
 */
export const requireFor =
  (what: string) =>
  <T>(value: T | null | undefined): T => {
    if (value === null || value === undefined) {
      throw new Error(`Expected ${what}, got ${String(value)}`);
    }
    return value;
  };
