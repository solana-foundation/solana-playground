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
