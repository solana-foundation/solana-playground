// A side-effect import, so the sort keeps it first: it defines the browser globals the modules `./generated` imports read under Node
import "./node-compatiblity";

import * as S from "./generated";
import { IS_NODE } from "./node-compatiblity";

/** All configurable settings */
export const SETTINGS = Object.values(S).flat();

// Needed to define `DEFAULT_SETTINGS`
if (IS_NODE) {
  // eslint-disable-next-line no-console -- craco.config.js reads the settings from this process's stdout
  console.log(
    `---DEFAULT_SETTINGS---\n${JSON.stringify(
      SETTINGS
    )}\n---DEFAULT_SETTINGS---`
  );
}
