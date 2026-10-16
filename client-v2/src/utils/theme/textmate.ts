/** The part of a TextMate rule that carries colours */
interface TextMateRule {
  settings: { foreground?: string; background?: string; fontStyle?: string };
}

/**
 * A TextMate theme with its colours resolved to hex. The theme holds
 * `var(--token)`, and the grammar engines (Monaco's, and shiki's
 * vscode-textmate, which drops any colour that is not hex) cannot read it,
 * so every consumer of `PgTheme.convertToTextMateTheme` passes through here.
 *
 * @param theme TextMate theme from `PgTheme.convertToTextMateTheme`
 * @param resolve turns a CSS colour into hex (`resolveColor` in the app)
 */
export const resolveTextMateTheme = <
  T extends { settings: readonly TextMateRule[] }
>(
  theme: T,
  resolve: (value: string) => string
): T => ({
  ...theme,
  settings: theme.settings.map((rule) => {
    const { foreground, background } = rule.settings;
    return {
      ...rule,
      settings: {
        ...rule.settings,
        ...(foreground && { foreground: resolve(foreground) }),
        ...(background && { background: resolve(background) }),
      },
    };
  }),
});

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  const resolve = (value: string) => `#resolved(${value})`;

  describe("resolveTextMateTheme", () => {
    it("resolves every foreground and background, so no var() reaches a grammar", () => {
      const resolved = resolveTextMateTheme(
        {
          name: "Dark",
          settings: [
            {
              name: "Defaults",
              settings: {
                background: "var(--surface-base)",
                foreground: "var(--text-primary)",
              },
            },
            {
              name: "Keyword",
              scope: ["keyword"],
              settings: {
                foreground: "var(--syntax-keyword)",
                fontStyle: "bold",
              },
            },
          ],
        },
        resolve
      );

      expect(resolved).toEqual({
        name: "Dark",
        settings: [
          {
            name: "Defaults",
            settings: {
              background: "#resolved(var(--surface-base))",
              foreground: "#resolved(var(--text-primary))",
            },
          },
          {
            name: "Keyword",
            scope: ["keyword"],
            settings: {
              foreground: "#resolved(var(--syntax-keyword))",
              fontStyle: "bold",
            },
          },
        ],
      });
    });

    it("leaves a rule without colours as it is", () => {
      const resolved = resolveTextMateTheme(
        {
          name: "Light",
          settings: [
            { scope: "markup.italic", settings: { fontStyle: "italic" } },
          ],
        },
        resolve
      );

      expect(resolved.settings[0].settings).toEqual({ fontStyle: "italic" });
    });
  });
}
