import { humanize } from "./humanize";

describe("humanize", () => {
  describe("E0308 - type mismatch", () => {
    it("detects string-to-integer mismatch", () => {
      const result = humanize(
        "E0308",
        "mismatched types",
        "expected `u64`, found `&str`"
      );
      expect(result.title).toBe("A text value is assigned to a number");
      expect(result.explanation).toBe(
        "Rust never converts between text and numbers implicitly; the value " +
          "has to be a number literal or parsed first."
      );
    });

    it("detects String-to-integer mismatch", () => {
      const result = humanize(
        "E0308",
        "mismatched types",
        "expected `i32`, found `String`"
      );
      expect(result.title).toBe("A text value is assigned to a number");
      expect(result.explanation).toBe(
        "Rust never converts between text and numbers implicitly; the value " +
          "has to be a number literal or parsed first."
      );
    });

    it("detects u8 mismatch with &str", () => {
      const result = humanize(
        "E0308",
        "mismatched types",
        "expected `u8`, found `&str`"
      );
      expect(result.title).toBe("A text value is assigned to a number");
      expect(result.explanation).toBe(
        "Rust never converts between text and numbers implicitly; the value " +
          "has to be a number literal or parsed first."
      );
    });

    it("detects usize mismatch with String", () => {
      const result = humanize(
        "E0308",
        "mismatched types",
        "expected `usize`, found `String`"
      );
      expect(result.title).toBe("A text value is assigned to a number");
      expect(result.explanation).toBe(
        "Rust never converts between text and numbers implicitly; the value " +
          "has to be a number literal or parsed first."
      );
    });

    it("detects i128 mismatch with &str", () => {
      const result = humanize(
        "E0308",
        "mismatched types",
        "expected `i128`, found `&str`"
      );
      expect(result.title).toBe("A text value is assigned to a number");
      expect(result.explanation).toBe(
        "Rust never converts between text and numbers implicitly; the value " +
          "has to be a number literal or parsed first."
      );
    });

    it("detects isize mismatch with String", () => {
      const result = humanize(
        "E0308",
        "mismatched types",
        "expected `isize`, found `String`"
      );
      expect(result.title).toBe("A text value is assigned to a number");
      expect(result.explanation).toBe(
        "Rust never converts between text and numbers implicitly; the value " +
          "has to be a number literal or parsed first."
      );
    });

    it("falls back for unrelated type mismatch", () => {
      const result = humanize(
        "E0308",
        "mismatched types",
        "expected `i32`, found `bool`"
      );
      expect(result.title).toBe("A value has the wrong type");
      expect(result.explanation).toBe(
        "The type the code provides does not match the type that position " +
          "expects."
      );
    });

    it("falls back without label", () => {
      const result = humanize("E0308", "mismatched types");
      expect(result.title).toBe("A value has the wrong type");
      expect(result.explanation).toBe(
        "The type the code provides does not match the type that position " +
          "expects."
      );
    });

    it("falls back with null label", () => {
      const result = humanize("E0308", "mismatched types", null);
      expect(result.title).toBe("A value has the wrong type");
      expect(result.explanation).toBe(
        "The type the code provides does not match the type that position " +
          "expects."
      );
    });
  });

  describe("E0425 - undefined name", () => {
    it("returns correct title and explanation", () => {
      const result = humanize("E0425", "cannot find value `x` in this scope");
      expect(result.title).toBe("A name is used that is not defined");
      expect(result.explanation).toBe(
        "Check the spelling, or add the `use` or `let` that introduces it."
      );
    });
  });

  describe("E0433 - unresolved path", () => {
    it("returns correct title and explanation", () => {
      const result = humanize(
        "E0433",
        "failed to resolve: use of undeclared type `Foo`"
      );
      expect(result.title).toBe("A path or crate cannot be found");
      expect(result.explanation).toBe(
        "The module or crate in this path is not imported or not on the " +
          "allowed crate list."
      );
    });
  });

  describe("E0599 - missing method", () => {
    it("returns correct title and explanation", () => {
      const result = humanize(
        "E0599",
        "no method named `foo` found for struct `Bar`"
      );
      expect(result.title).toBe("A method does not exist on this type");
      expect(result.explanation).toBe(
        "The receiver's type has no such method; check the type or import " +
          "the trait that provides it."
      );
    });
  });

  describe("E0382 - value moved", () => {
    it("returns correct title and explanation", () => {
      const result = humanize("E0382", "borrow of moved value: `x`");
      expect(result.title).toBe("A value is used after it was moved");
      expect(result.explanation).toBe(
        "Ownership moved to an earlier call; clone it, borrow it, or " +
          "restructure the calls."
      );
    });
  });

  describe("E0277 - trait not implemented", () => {
    it("returns correct title and explanation", () => {
      const result = humanize(
        "E0277",
        "`Foo` cannot be formatted with the default formatter"
      );
      expect(result.title).toBe("A trait the code needs is not implemented");
      expect(result.explanation).toBe(
        "The type does not implement the trait this call requires; derive or " +
          "implement it, or use a different type."
      );
    });
  });

  describe("fallback", () => {
    it("uses rustcTitle when code is null", () => {
      const result = humanize(null, "custom error title");
      expect(result.title).toBe("custom error title");
      expect(result.explanation).toBe("");
    });

    it("uses rustcTitle for unknown code", () => {
      const result = humanize("E9999", "unknown error");
      expect(result.title).toBe("unknown error");
      expect(result.explanation).toBe("");
    });

    it("uses rustcTitle for empty code", () => {
      const result = humanize("", "some error");
      expect(result.title).toBe("some error");
      expect(result.explanation).toBe("");
    });
  });
});
