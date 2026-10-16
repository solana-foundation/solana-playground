import { expect, test } from "@playwright/test";

/**
 * Tailwind reaches the page only through craco's PostCSS override. If that
 * stops applying (a craco upgrade, a second CSS rule added after craco's
 * style pass), the build stays green and every utility goes inert. The Flow
 * wrapper's three utilities repeat its styled rule, so a screenshot cannot
 * tell either; this reads the rules themselves out of the utilities layer.
 */
test("Tailwind utilities reach the page in the utilities layer", async ({
  page,
}) => {
  await page.goto("/");
  const wrapper = page.locator("div.flex.flex-col.overflow-hidden");
  await expect(wrapper).toHaveCount(1);

  const rules = await page.evaluate(() => {
    const found: Record<string, string> = {};
    const walk = (list: CSSRuleList, layer: string | null) => {
      for (const rule of Array.from(list)) {
        if (rule instanceof CSSLayerBlockRule) walk(rule.cssRules, rule.name);
        else if (rule instanceof CSSStyleRule && layer === "utilities") {
          found[rule.selectorText] = rule.style.cssText;
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        walk(sheet.cssRules, null);
      } catch (e) {
        // Only a cross-origin sheet (Google Fonts) may be unreadable, and it
        // is not ours; anything else is a real fault in a sheet we ship.
        const crossOrigin =
          e instanceof DOMException && e.name === "SecurityError";
        if (!crossOrigin) throw e;
      }
    }
    return found;
  });

  expect(rules[".flex"]).toContain("display: flex");
  expect(rules[".flex-col"]).toContain("flex-direction: column");
  expect(rules[".overflow-hidden"]).toContain("overflow: hidden");
});
