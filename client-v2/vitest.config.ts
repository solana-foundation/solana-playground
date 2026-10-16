import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";
import type { Plugin } from "vite";

// Webpack loads `.md` as raw text (`asset/source` in `craco.config.js`). This
// covers `import` of a `.md` file; `require` goes to Node, past any plugin,
// and is covered by the hook in `src/setupTests.ts`. Only `.md` is covered.
const markdownAsText: Plugin = {
  name: "markdown-as-text",
  transform(src, id) {
    if (!id.endsWith(".md")) return null;
    return { code: `export default ${JSON.stringify(src)};`, map: null };
  },
};

export default defineConfig({
  plugins: [markdownAsText],
  resolve: {
    alias: [
      // `tsconfig.json`'s `paths`: `@/` is `src/`
      {
        find: /^@\//,
        replacement: fileURLToPath(new URL("./src/", import.meta.url)),
      },
      // monaco-editor declares only `module`, no `main`. Webpack takes
      // `module`; vite's server-side resolution does not, so point it there.
      {
        find: /^monaco-editor$/,
        replacement: "monaco-editor/esm/vs/editor/editor.main.js",
      },
    ],
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["src/setupTests.ts"],
    // CRA's `testMatch`, so the same files are collected: not `e2e/`
    // (Playwright), not `*.test.mjs` (`node --test`).
    include: [
      "src/**/__tests__/**/*.{js,jsx,ts,tsx}",
      "src/**/*.{spec,test}.{js,jsx,ts,tsx}",
    ],
    css: false,
    // The closest match to CRA 5's Jest `resetMocks: true`, with two
    // differences: a `vi.fn(impl)` is reset back to `impl`, and a `vi.spyOn`
    // spy back to calling the real method, where Jest left both returning
    // `undefined`. So a spy that must answer something is set up per test.
    mockReset: true,
  },
});
