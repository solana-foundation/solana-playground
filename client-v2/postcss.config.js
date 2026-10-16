// Tailwind first, then the three plugins CRA 5 runs by default (see
// react-scripts/config/webpack.config.js), in CRA's order and with CRA's
// options. craco.config.js points postcss-loader at this file through
// `postcssOptions.config`; the comment there says why craco's own `file` mode
// is not used. In production `@tailwindcss/postcss` also runs Lightning CSS
// over the whole sheet before the three CRA plugins see it.
module.exports = {
  plugins: [
    require("@tailwindcss/postcss"),
    require("postcss-flexbugs-fixes"),
    require("postcss-preset-env")({
      autoprefixer: { flexbox: "no-2009" },
      stage: 3,
    }),
    require("postcss-normalize"),
  ],
};
