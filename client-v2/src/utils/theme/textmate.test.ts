import { describe, expect, it } from "vitest";

import { resolveTextMateTheme } from "./textmate";

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
