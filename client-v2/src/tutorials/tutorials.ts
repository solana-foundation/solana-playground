import { markdownTutorials } from "./create";
import { listTutorials } from "./definitions";
import * as customTutorials from "./generated";

const others = Object.values(customTutorials).concat(markdownTutorials);

/** All visible tutorials at `/tutorials`: the conversation ones first */
export const TUTORIALS = listTutorials(others);
