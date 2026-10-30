import { expect, test } from "@playwright/test";

/**
 * Tailwind reaches the page only through craco's PostCSS override. If that
 * stops applying (a craco upgrade, a second CSS rule added after craco's
 * style pass), the build stays green and every utility goes inert, which a
 * screenshot shows only as a broken page after the fact; this reads the
 * rules themselves out of the utilities layer.
 * The anchor only proves that some element carries the three utilities,
 * since design-system parts use them too; the rule checks below are what
 * guard the build.
 */
test("Tailwind utilities reach the page in the utilities layer", async ({
  page,
}) => {
  await page.goto("/");
  const wrapper = page.locator("div.flex.flex-col.overflow-hidden");
  await expect(wrapper.first()).toBeVisible();

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

/**
 * The stock Checkbox and Switch style their checked state with `data-checked:`
 * utilities, but Radix sets `data-state`. shadcn/tailwind.css (imported in index.css)
 * defines the variants for both spellings; if that import stops reaching the page
 * the parts render, and a checked box looks unchecked. Checkbox is mounted
 * (the assistant's Sources); Switch is not mounted yet. So this reads the rule
 * out of the utilities layer.
 */
test("data-checked utilities match Radix's data-state", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.locator("div.flex.flex-col.overflow-hidden").first()
  ).toBeVisible();

  const selectors = await page.evaluate(() => {
    const found: string[] = [];
    const walk = (list: CSSRuleList, layer: string | null) => {
      for (const rule of Array.from(list)) {
        if (rule instanceof CSSLayerBlockRule) walk(rule.cssRules, rule.name);
        else if (rule instanceof CSSStyleRule && layer === "utilities") {
          found.push(rule.selectorText);
        } else if (rule instanceof CSSGroupingRule && layer === "utilities") {
          walk(rule.cssRules, layer);
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        walk(sheet.cssRules, null);
      } catch (e) {
        const crossOrigin =
          e instanceof DOMException && e.name === "SecurityError";
        if (!crossOrigin) throw e;
      }
    }
    return found;
  });

  expect(
    selectors.some(
      (s) => s.includes("data-checked") && s.includes('data-state="checked"')
    )
  ).toBe(true);
  expect(
    selectors.some(
      (s) =>
        s.includes("data-unchecked") && s.includes('data-state="unchecked"')
    )
  ).toBe(true);
});
