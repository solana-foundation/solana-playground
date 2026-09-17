const webpack = require("webpack");
const MonacoWebpackPlugin = require("monaco-editor-webpack-plugin");
const CircularDependencyPlugin = require("circular-dependency-plugin");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// CRA's missing-index.html error gives no hint that public/ is a submodule.
if (!fs.existsSync(path.join(__dirname, "public", "index.html"))) {
  throw new Error(
    "client-v2/public has no index.html. These assets are tracked files, " +
      "not a submodule, so a normal checkout has them.\n" +
      "To restore: make update-static"
  );
}

module.exports = {
  webpack: {
    configure: (webpackConfig) => {
      // Resolve WASM and CommonJS
      webpackConfig.resolve.extensions.push(".wasm");
      webpackConfig.experiments = {
        asyncWebAssembly: true,
      };
      webpackConfig.module.rules.forEach((rule) => {
        (rule.oneOf ?? []).forEach((oneOf) => {
          if (oneOf.type === "asset/resource") {
            // Including .cjs here solves `nanoid is not a function`
            oneOf.exclude.push(/\.wasm$/, /\.cjs$/);
          } else if (new RegExp(oneOf.test).test(".d.ts")) {
            // Exclude declaration files from being loaded by babel
            oneOf.exclude = [/\.d\.ts$/];
          }
        });
      });

      webpackConfig.module.rules.push(
        // Fix process error on @lezer/lr
        {
          test: /@lezer\/lr\/dist\/\w+\.js$/,
          resolve: { fullySpecified: false },
        },

        // Raw imports
        {
          test: /\.(d\.ts|raw|rs|py|md|toml)$/,
          type: "asset/source",
        },

        // Resource query
        {
          resourceQuery: /resource/,
          type: "asset/resource",
        }
      );

      // Resolve node polyfills
      webpackConfig.resolve.fallback = {
        // Mocha
        stream: require.resolve("stream-browserify"),

        // Fix `Module not found: Error: Can't resolve 'perf_hooks'` from typescript
        perf_hooks: false,

        // @metaplex-foundation/js polyfills
        crypto: require.resolve("crypto-browserify"),
        fs: false,
        process: false,
        path: false,
        zlib: false,
      };

      // Webpack treats `node:` as a URI scheme and rejects it before
      // `resolve.fallback` or aliases get a chance, so rewrite it away. The
      // Anthropic SDK reaches `node:fs` and `node:path` from its on-disk
      // credential resolution, which cannot apply in a browser — the assistant
      // passes the key explicitly — and the fallbacks above stub them out.
      webpackConfig.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
          resource.request = resource.request.replace(/^node:/, "");
        })
      );

      // Plugins
      webpackConfig.plugins.push(
        // Buffer
        new webpack.ProvidePlugin({ Buffer: ["buffer", "Buffer"] }),

        // Process
        new webpack.ProvidePlugin({
          process: "process/browser",
        }),

        // Monaco
        new MonacoWebpackPlugin(),

        // Circular dependencies
        new CircularDependencyPlugin({
          // TODO: Avoid excluding so many or be more specific
          exclude:
            /node_modules|connection|explorer|playnet|sugar|terminal|Instruction/,
          // Include all src folder
          include: /src/,
          // Add errors to webpack instead of warnings
          failOnError: true,
          // Allow import cycles that include an asynchronous import,
          // e.g. via import(/* webpackMode: "weak" */ './file.js')
          allowAsyncCycles: false,
          // Set the current working directory for displaying module paths
          cwd: process.cwd(),
        }),

        // Ignore `Critical dependency: the request of a dependency is an expression`
        // from typescript and mocha
        new webpack.ContextReplacementPlugin(/^\.$/, (context) => {
          if (/\/node_modules\/(typescript|mocha)\/lib/.test(context.context)) {
            for (const d of context.dependencies) {
              if (d.critical) d.critical = false;
            }
          }
        }),

        // Define globals
        new webpack.DefinePlugin({
          /** Setting info */
          GLOBAL_SETTINGS: (() => {
            const settingsPath = path.join("src", "settings");
            const settingsStr = execSync(
              `yarn run tsx ${settingsPath} --no-warnings`,
              { env: { ...process.env, NODE_NO_WARNINGS: 1 } }
            )
              .toString()
              .split("---DEFAULT_SETTINGS---")
              .at(1);
            if (!settingsStr) throw new Error("Settings not found");

            const settings = JSON.parse(settingsStr);

            const defaultSettings = settings.reduce((acc, cur) => {
              if (cur.default === undefined) return acc;

              const accessor = cur.id.split(".");
              accessor.reduce((obj, field, i) => {
                if (i === accessor.length - 1) obj[field] = cur.default;
                else obj[field] ??= {};
                return obj[field];
              }, acc);

              return acc;
            }, {});

            const migrations = settings.reduce((acc, cur) => {
              if (cur.migrate) {
                const froms = Array.isArray(cur.migrate.from)
                  ? cur.migrate.from
                  : [cur.migrate.from];
                for (const from of froms) acc.push({ from, to: cur.id });
              }

              return acc;
            }, []);

            return JSON.stringify({
              default: defaultSettings,
              migrations,
            });
          })(),

          /** All supported crates(Rust Analyzer) */
          CRATES: defineFromPublicDir("crates", (dirItems) => {
            const importable = Object.keys(
              JSON.parse(
                fs.readFileSync(path.join("..", "supported-crates.json"))
              )
            ).map((name) => name.replaceAll("-", "_"));

            const transitive = dirItems
              .filter((name) => name.endsWith(".toml"))
              .map((name) => name.replace(".toml", ""))
              .filter((name) => !importable.includes(name));

            return { importable, transitive };
          }),

          /** Supported packages(TypeScript) */
          PACKAGES: fs.readFileSync(
            path.join("..", "supported-packages.json"),
            "utf8"
          ),

          /** Array of all markdown tutorial data */
          MARKDOWN_TUTORIALS: defineFromPublicDir(
            "tutorials",
            (dirItems, tutorialsPath) => {
              return dirItems
                .filter((tutorialName) => !tutorialName.startsWith("_"))
                .map((tutorialName) => {
                  const tutorialDir = path.join(tutorialsPath, tutorialName);
                  const tutorialDirItems = fs.readdirSync(tutorialDir);
                  const tutorialDataFileName = tutorialDirItems.find(
                    (name) => name === "data.json"
                  );
                  if (!tutorialDataFileName) return null;

                  const data = JSON.parse(
                    fs.readFileSync(
                      path.join(tutorialDir, tutorialDataFileName)
                    )
                  );
                  data.pageCount = fs.readdirSync(
                    path.join(tutorialDir, "pages")
                  ).length;
                  data.unixTimestamp =
                    TUTORIAL_TIMESTAMPS[tutorialName] ??
                    gitAddedTimestamp(tutorialDir);

                  const thumbnailFileName = tutorialDirItems.find((name) =>
                    name.startsWith("thumbnail")
                  );
                  if (thumbnailFileName) data.thumbnail ??= thumbnailFileName;

                  return data;
                })
                .filter(Boolean);
            }
          ),

          /** Map of kebab-case tutorial names to necessary custom tutorial data */
          CUSTOM_TUTORIALS: defineFromPublicDir(
            "tutorials",
            (dirItems, tutorialsPath) => {
              return dirItems.reduce((acc, tutorialName) => {
                const tutorialDir = path.join(tutorialsPath, tutorialName);
                const tutorialDirItems = fs.readdirSync(tutorialDir);
                const tutorialDataFileName = tutorialDirItems.find(
                  (name) => name === "data.json"
                );
                if (tutorialDataFileName) return acc;

                acc[tutorialName] ??= {};

                // Thumbnail
                const thumbnailFileName = tutorialDirItems.find((name) =>
                  name.startsWith("thumbnail")
                );
                if (thumbnailFileName)
                  acc[tutorialName].thumbnail = thumbnailFileName;

                // Page count
                const pagesDirs = [
                  path.join(tutorialDir, "pages"),
                  path.join("src", "tutorials", tutorialName, "pages"),
                ];
                for (const pagesDir of pagesDirs) {
                  if (fs.existsSync(pagesDir)) {
                    acc[tutorialName].pageCount =
                      fs.readdirSync(pagesDir).length;
                    break;
                  }
                }
                if (!acc[tutorialName].pageCount) {
                  throw new Error("Unable to get tutorial page count");
                }

                return acc;
              }, {});
            }
          ),
        })
      );

      // Do not mangle class names that start with "_Pg" because decorators'
      // main change event name is derived from the class name.
      const terserPlugin = webpackConfig.optimization.minimizer[0];

      // Decarators can be transpiled to either classses or functions, exclude
      // all class/function names that start with "_Pg".
      // See: https://github.com/terser/terser#minify-options-structure
      terserPlugin.options.minimizer.options.keep_classnames = /^_Pg/;
      terserPlugin.options.minimizer.options.keep_fnames = /^_Pg/;

      // Ignore useless warnings
      webpackConfig.ignoreWarnings = [
        /Failed to parse source map/,

        // https://github.com/GoogleChromeLabs/wasm-bindgen-rayon/issues/23
        /Circular dependency between chunks with runtime/,
      ];

      return webpackConfig;
    },
  },

  devServer: (devServerConfig) => {
    devServerConfig.headers = {
      ...devServerConfig.headers,
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
    };

    // Serve `api/*.mjs` from the dev server itself, so local API work needs
    // neither `vercel dev` (which wants a login and team access) nor a second
    // process. Wrapping CRA's hook rather than using `setupMiddlewares`:
    // webpack-dev-server 4 throws if both are set, and CRA sets this one.
    const onBefore = devServerConfig.onBeforeSetupMiddleware;
    devServerConfig.onBeforeSetupMiddleware = (devServer) => {
      onBefore?.(devServer);
      devServer.app.use("/api", serveApiRoute);
    };

    return devServerConfig;
  },
};

/** Answer as the platform would, not as the SPA fallback would */
const sendJson = (res, status, body) => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
};

/**
 * Map an `/api` sub-path to the module that serves it.
 *
 * Only the first segment selects the module, so `api/auth.mjs` serves every
 * `/api/auth/...` path the way a platform catch-all does. Every segment is
 * still constrained rather than sanitised, because the value reaches
 * `import()`.
 *
 * @param {string} url the path below `/api`, query string included
 * @returns {{name: string} | null} the module to import, or `null` for 404
 */
const resolveApiRoute = (url) => {
  const segments = url.split("?")[0].split("/").filter(Boolean);
  if (!segments.length) return null;
  if (
    !segments.every(
      (s) => /^[A-Za-z0-9._-]+$/.test(s) && s !== ".." && s !== "."
    )
  ) {
    return null;
  }

  const [name] = segments;
  return /^[a-z0-9-]+$/.test(name) ? { name } : null;
};

/**
 * Dispatch `/api/<name>` to `api/<name>.mjs`, matching how the deployed
 * function is invoked.
 *
 * Never calls `next()`: falling through would hand an unknown `/api` path to
 * the history fallback, which answers `200 text/html` with `index.html` and
 * shows up in a client as `Unexpected token '<'`. A 404 is both the truth and
 * what the deployment does.
 *
 * @param {import("http").IncomingMessage & {url: string}} req
 * @param {import("http").ServerResponse} res
 */
const serveApiRoute = async (req, res) => {
  // Mounted on `/api`, so `req.url` is the remainder.
  //
  // NOTE: the `import()` below caches, and nothing here invalidates it. Editing
  // an `api/*.mjs` route, or a `.mjs` one of them imports (the per-feature
  // `config.mjs` files), does NOT hot-reload the way `src` does -- the server
  // keeps serving the module it first loaded, and a newly added export shows up
  // as "does not provide an export named X". Restart the dev server after such
  // an edit.
  const route = resolveApiRoute(req.url);
  if (!route) {
    return sendJson(res, 404, { error: `No API route at /api${req.url}` });
  }

  try {
    const mod = await import(`./api/${route.name}.mjs`);
    await mod.default(req, res);
  } catch (e) {
    if (e.code === "ERR_MODULE_NOT_FOUND") {
      return sendJson(res, 404, {
        error: `No API route at /api/${route.name}`,
      });
    }
    sendJson(res, 500, { error: e.message });
  }
};

/** Real asset-repo dates captured by `make update-static`; see that script */
const TUTORIAL_TIMESTAMPS = (() => {
  const file = path.join("public", "tutorial-timestamps.json");
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
})();

/** When the directory's first file was added, per git history */
const gitAddedTimestamp = (dir) =>
  execSync("git log --follow --format=%ad --date=unix --diff-filter=A .", {
    cwd: dir,
  })
    .toString()
    .split("\n")
    .filter(Boolean)
    .pop();

/**
 * Define global variable based on the items in `public` directory.
 *
 * @param {string} dirName directory name inside `public` directory
 * @param {(dirItems: string[], path: string) => string} cb callback to run
 * @returns the stringified result of the callback
 */
const defineFromPublicDir = (dirName, cb) => {
  const publicPath = path.join("public", dirName);

  if (!fs.existsSync(publicPath)) {
    fs.mkdirSync(publicPath);
  }

  return JSON.stringify(cb(fs.readdirSync(publicPath), publicPath));
};

// Exported for tests only. The craco config itself is the default export
// above; this is the one pure function in the file worth covering directly.
module.exports.resolveApiRoute = resolveApiRoute;
