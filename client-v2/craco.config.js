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

// Node 22 `require`s an ES module; the id list is shared with the API functions
const {
  missingObservabilityIds,
} = require("./src/features/api/server/observability.mjs");

// The build succeeds without these, so say in the build log what it ships without
const warnAboutMissingObservabilityIds = () => {
  for (const message of missingObservabilityIds(process.env)) {
    console.warn(`warning: ${message}`);
  }
};

const HtmlWebpackPlugin = require("html-webpack-plugin");
const { insertGoogleTag } = require("./scripts/google-tag.mjs");

/** Writes Google's tag into index.html; added to the build only with an id */
class GoogleTagPlugin {
  constructor(id) {
    this.id = id;
  }

  apply(compiler) {
    compiler.hooks.compilation.tap("GoogleTagPlugin", (compilation) => {
      HtmlWebpackPlugin.getHooks(compilation).beforeEmit.tap(
        "GoogleTagPlugin",
        (data) => ({ ...data, html: insertGoogleTag(data.html, this.id) })
      );
    });
  }
}

const { DEV_SERVER_ROOT_HEADER } = require("./scripts/dev-server-owner.mjs");
const { sentryEnabled } = require("./scripts/sentry-gate.mjs");
const { sourcemapsEnabled } = require("./scripts/sourcemap-gate.mjs");

const { esbuildMinifyOptions } = require("./scripts/esbuild-minify.mjs");
const {
  MODULES_FILE,
  slimModules,
} = require("./scripts/lib/bundle/modules.mjs");

/** Writes the bundle's module list for `scripts/bundle-modules.build-test.mjs`; only the module list names a test helper that ships */
class BundleModulesPlugin {
  apply(compiler) {
    // Removed first, so a build that cannot write the list leaves none for the test to read as current
    compiler.hooks.run.tap("BundleModulesPlugin", () => {
      try {
        fs.rmSync(MODULES_FILE, { force: true });
      } catch (e) {
        // A list left behind is older than build/index.html, which yarn test-build rejects
        console.error(
          `BundleModulesPlugin: could not remove ${MODULES_FILE}: ${e.message}`
        );
      }
    });
    compiler.hooks.done.tap("BundleModulesPlugin", (stats) => {
      try {
        const { modules } = stats.toJson({
          all: false,
          modules: true,
          nestedModules: true,
          // CRA's filesystem cache serves most modules on a rebuild, and `all: false` would leave those out
          cachedModules: true,
        });
        fs.mkdirSync(path.dirname(MODULES_FILE), { recursive: true });
        fs.writeFileSync(MODULES_FILE, JSON.stringify(slimModules(modules)));
      } catch (e) {
        // Only a build test reads the list, so a failure here must not fail the build
        console.error(
          `BundleModulesPlugin: wrote no ${MODULES_FILE}, so yarn test-build will fail: ${e.message}`
        );
      }
    });
  }
}

/** CRA's in-build type check and lint, by plugin class name */
const BUILD_ONLY_CHECKS = [
  "ForkTsCheckerWebpackPlugin",
  "ForkTsCheckerWarningWebpackPlugin",
  "ESLintWebpackPlugin",
];

/**
 * Each tracker: whether this build carries it, and the files that hold its
 * code under `src/shared/lib`, each with the `-off` stub of the same shape
 * that replaces it when the tracker is off.
 */
const TRACKERS = [
  {
    enabled: sentryEnabled,
    files: [["reporter/sentry.ts", "reporter/sentry-off.ts"]],
  },
  {
    enabled: (env) => !!env.REACT_APP_GA_MEASUREMENT_ID,
    files: [
      ["telemetry/providers/ga4.ts", "telemetry/providers/ga4-off.ts"],
      ["telemetry/google-analytics.tsx", "telemetry/google-analytics-off.tsx"],
    ],
  },
];

/**
 * Absolute file -> its stub, for each tracker this build leaves out. Throws
 * when a listed file is missing: a renamed file would otherwise be bundled.
 */
const trackerSwaps = (env) => {
  const swaps = new Map();
  for (const { enabled, files } of TRACKERS) {
    if (enabled(env)) continue;
    for (const pair of files) {
      const [file, stub] = pair.map((p) =>
        path.join(__dirname, "src/shared/lib", p)
      );
      for (const p of [file, stub]) {
        if (!fs.existsSync(p)) {
          throw new Error(`craco: ${p} is missing; update TRACKERS`);
        }
      }
      swaps.set(file, stub);
    }
  }
  return swaps;
};

/** Bundles a stub wherever a module resolves to a file in `swaps` */
class SwapFilesPlugin {
  constructor(swaps) {
    this.swaps = swaps;
  }

  apply(compiler) {
    compiler.hooks.normalModuleFactory.tap("SwapFilesPlugin", (factory) => {
      factory.hooks.afterResolve.tap("SwapFilesPlugin", ({ createData }) => {
        const stub = this.swaps.get(createData.resource);
        if (stub) createData.resource = stub;
      });
    });
  }
}

module.exports = {
  style: {
    postcss: {
      // Hand PostCSS to `postcss.config.js` whole, so Tailwind runs before
      // CRA's own plugins. craco 6's two modes predate CRA 5's `postcssOptions`
      // shape: `extends` calls `options.plugins()`, which is gone, and `file`
      // writes a top-level `ident` key (the postcss-loader 3 form) that
      // postcss-loader 6's strict schema rejects. So the loader options are
      // rebuilt here: CRA's source-map choice is kept and everything else
      // comes from the config file.
      loaderOptions: (options) => ({
        sourceMap: options.sourceMap,
        postcssOptions: { config: path.join(__dirname, "postcss.config.js") },
      }),
    },
  },

  webpack: {
    configure: (webpackConfig, { env }) => {
      // tsconfig `paths` is the only `@/` mapping; react-scripts 5 strips it only in `init`, never in start or build
      webpackConfig.resolve.tsconfig = path.join(__dirname, "tsconfig.json");

      // Here, not at the top: CRA's `config/env.js` has loaded `.env` by now
      warnAboutMissingObservabilityIds();

      // `test-types` and `lint` run in CI and in `check`; in a production
      // build these plugins only add memory under Vercel's 8 GB limit
      if (env === "production") {
        webpackConfig.plugins = webpackConfig.plugins.filter(
          (plugin) => !BUILD_ONLY_CHECKS.includes(plugin.constructor.name)
        );
        // Only `yarn test-build` reads the module list, and a deployment runs no build test
        if (!process.env.VERCEL) {
          webpackConfig.plugins.push(new BundleModulesPlugin());
        }
      }

      // `build:bundle` passes GENERATE_SOURCEMAP=false, so CRA emits none; hidden maps
      // carry no `sourceMappingURL`, so browsers never fetch them
      if (env === "production" && sourcemapsEnabled(process.env)) {
        webpackConfig.devtool = "hidden-source-map";
      }

      // A tracker this build leaves out adds no code. One it carries is not
      // swapped, so Sentry still initialises during the first render.
      if (process.env.REACT_APP_SENTRY_DSN && !sentryEnabled(process.env)) {
        console.warn(
          `warning: Sentry is off for VERCEL_ENV=${
            process.env.VERCEL_ENV ?? "(unset)"
          }; ` +
            "it reports from production, and from preview with SENTRY_PREVIEW_ENABLED=true"
        );
      }
      const swaps = trackerSwaps(process.env);
      if (swaps.size) webpackConfig.plugins.push(new SwapFilesPlugin(swaps));

      // In <head> from the first byte, rather than once the bundle has run
      const gaId = process.env.REACT_APP_GA_MEASUREMENT_ID;
      if (gaId) webpackConfig.plugins.push(new GoogleTagPlugin(gaId));

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
        vm: false, // parse-asn1's asn1.js 4 requires `vm` in a try/catch: unresolved it warns, stubbed it falls back

        // ConnectorKit imports WalletConnect lazily, only when it is
        // configured, and the app does not configure it
        // (`entities/external-wallet`); the peer is not installed
        "@walletconnect/universal-provider": false,
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
          CRATES: JSON.stringify({
            importable: Object.keys(
              JSON.parse(
                fs.readFileSync(path.join("..", "supported-crates.json"))
              )
            ).map((name) => name.replaceAll("-", "_")),
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

      // CRA's Terser plugin, minifying with esbuild: Terser's parallel syntax
      // trees peaked the build at 9.6 GB, over Vercel's 8 GB limit
      const jsMinimizer = webpackConfig.optimization.minimizer[0];
      if (jsMinimizer.constructor.name !== "TerserPlugin") {
        throw new Error(
          "craco: expected CRA's first minimizer to be TerserPlugin"
        );
      }
      jsMinimizer.options.minimizer = {
        implementation: jsMinimizer.constructor.esbuildMinify, // CRA's own copy, not whichever one hoisting resolves
        options: esbuildMinifyOptions(),
      };
      // Workers are threads in this process, outside `--max-old-space-size`
      jsMinimizer.options.parallel = 2;

      // CRA's CSS minimizer, without cssnano's postcss-calc: it cannot parse
      // a `calc()` inside a `var()` fallback, which the design system's
      // `scroll-fade-*` utilities emit, and CI fails the build on its warning
      const cssMinimizer = webpackConfig.optimization.minimizer.find(
        (plugin) => plugin.constructor.name === "CssMinimizerPlugin"
      );
      if (!cssMinimizer) {
        throw new Error("craco: expected CRA's CssMinimizerPlugin");
      }
      cssMinimizer.options.minimizer.options = {
        preset: ["default", { calc: false }],
      };

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
      // Names this worktree's client-v2, so a local e2e run can tell its own
      // server from another worktree's on the same port (`decideDevServer`).
      // Percent-encoded: a header value must be ASCII, a path need not be.
      [DEV_SERVER_ROOT_HEADER]: encodeURIComponent(__dirname),
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
 * `/api/auth/...` path -- which on the platform takes a `vercel.json` rewrite,
 * because no `api/` file name spans segments (see `api-routing.test.mjs`).
 * Every segment is still constrained rather than sanitised, because the value
 * reaches `import()`.
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
