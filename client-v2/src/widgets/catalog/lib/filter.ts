const has = (text: string, q: string) => text.toLowerCase().includes(q);

const normal = (query: string) => query.trim().toLowerCase();

/** A tutorial matches on its name or description; an empty query matches all */
export const matchesTutorial = (
  t: { name: string; description: string },
  query: string
) => {
  const q = normal(query);
  return !q || has(t.name, q) || has(t.description, q);
};

/** A program matches on its name, description or any of its categories */
export const matchesProgram = (
  p: { name: string; description: string; categories: string[] },
  query: string
) => {
  const q = normal(query);
  return (
    !q ||
    has(p.name, q) ||
    has(p.description, q) ||
    p.categories.some((c) => has(c, q))
  );
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("widgets/catalog/lib/filter", () => {
    const tutorial = {
      name: "Hello Seahorse",
      description: "Python on Solana",
    };
    const program = {
      name: "mpl-bubblegum",
      description: "Compressed NFTs",
      categories: ["NFT"],
    };

    it("matches a tutorial by name or description, ignoring case and spaces", () => {
      expect(matchesTutorial(tutorial, " seahorse ")).toBe(true);
      expect(matchesTutorial(tutorial, "PYTHON")).toBe(true);
      expect(matchesTutorial(tutorial, "anchor")).toBe(false);
    });

    it("matches a program by its categories too", () => {
      expect(matchesProgram(program, "nft")).toBe(true);
      expect(matchesProgram(program, "bubble")).toBe(true);
      expect(matchesProgram(program, "defi")).toBe(false);
    });

    it("matches everything on an empty query", () => {
      expect(matchesTutorial(tutorial, "  ")).toBe(true);
      expect(matchesProgram(program, "")).toBe(true);
    });
  });
}
