// A side-effect import, so the sort keeps it first: it defines the browser globals `./generated` reads under Node
import "./node-compatiblity";

import * as S from "./generated";
import { IS_NODE } from "./node-compatiblity";

/** All configurable settings */
export const SETTINGS = Object.values(S).flat();

// Needed to define `DEFAULT_SETTINGS`
if (IS_NODE) {
  console.log("---DEFAULT_SETTINGS---");
  console.log(JSON.stringify(SETTINGS));
  console.log("---DEFAULT_SETTINGS---");
}
