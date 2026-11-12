/**
 * Whether two IDL names (an instruction, an argument, an account) name the
 * same thing. Case- and underscore-blind: an IDL spells `greet_by_name` in
 * snake_case or camelCase depending on the Anchor version that wrote it, and
 * a decoded call names it as the client does, while a lesson or a tutorial
 * definition names it as the Rust source does.
 */
export const sameIdlName = (a: string, b: string): boolean =>
  fold(a) === fold(b);

const fold = (name: string) => name.replace(/_/g, "").toLowerCase();

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("shared/lib/idl-name", () => {
    it("matches across case and the snake/camel spelling", () => {
      expect(sameIdlName("greet_by_name", "greetByName")).toBe(true);
      expect(sameIdlName("Hello", "hello")).toBe(true);
    });

    it("tells different names apart", () => {
      expect(sameIdlName("hello", "hell")).toBe(false);
      expect(sameIdlName("hello", "hello_world")).toBe(false);
    });
  });
}
