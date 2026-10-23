import { createCn } from "cn/config"

/**
 * `cn` that knows the theme's type scale (`--text-*`, `--font-weight-*` in
 * theme.css). The stock `cn` reads `text-control` as a colour and
 * `font-act` as a font family, so a later `text-foreground` or `font-mono`
 * silently drops them.
 */
export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [
        { text: ["display", "title", "body", "control", "caption", "code"] },
      ],
      "font-weight": [{ font: ["read", "label", "headline", "act"] }],
    },
  },
})
