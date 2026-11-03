import { markdownTutorials } from "./create";
import * as customTutorials from "./generated";

/** All visible tutorials at `/tutorials` */
export const TUTORIALS =
  Object.values(customTutorials).concat(markdownTutorials);
