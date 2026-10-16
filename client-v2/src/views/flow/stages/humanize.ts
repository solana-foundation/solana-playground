export interface Humanized {
  title: string;
  explanation: string;
}

/**
 * Plain-language title and one-sentence explanation for a rustc error
 * code; falls back to rustc's own title.
 */
export const humanize = (
  code: string | null,
  rustcTitle: string,
  label?: string | null
): Humanized => {
  if (!code) {
    return { title: rustcTitle, explanation: "" };
  }

  const integerTypes =
    /\b(u8|u16|u32|u64|u128|i8|i16|i32|i64|i128|usize|isize)\b/;
  const textTypes = /(&str|String)/;

  switch (code) {
    case "E0308":
      if (label && textTypes.test(label) && integerTypes.test(label)) {
        return {
          title: "A text value is assigned to a number",
          explanation:
            "Rust never converts between text and numbers " +
            "implicitly; the value has to be a number literal or " +
            "parsed first.",
        };
      }
      return {
        title: "A value has the wrong type",
        explanation:
          "The type the code provides does not match the type " +
          "that position expects.",
      };

    case "E0425":
      return {
        title: "A name is used that is not defined",
        explanation:
          "Check the spelling, or add the `use` or `let` that " +
          "introduces it.",
      };

    case "E0433":
      return {
        title: "A path or crate cannot be found",
        explanation:
          "The module or crate in this path is not imported or " +
          "not on the allowed crate list.",
      };

    case "E0599":
      return {
        title: "A method does not exist on this type",
        explanation:
          "The receiver's type has no such method; check the " +
          "type or import the trait that provides it.",
      };

    case "E0382":
      return {
        title: "A value is used after it was moved",
        explanation:
          "Ownership moved to an earlier call; clone it, borrow " +
          "it, or restructure the calls.",
      };

    case "E0277":
      return {
        title: "A trait the code needs is not implemented",
        explanation:
          "The type does not implement the trait this call " +
          "requires; derive or implement it, or use a different " +
          "type.",
      };

    default:
      return { title: rustcTitle, explanation: "" };
  }
};
