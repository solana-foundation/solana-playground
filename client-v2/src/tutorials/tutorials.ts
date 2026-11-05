import { markdownTutorials } from "./create";
import { definitionTutorials } from "./definitions";
import * as customTutorials from "./generated";

const others = Object.values(customTutorials).concat(markdownTutorials);

/** All visible tutorials at `/tutorials`: the conversation ones first */
export const TUTORIALS = definitionTutorials(others).concat(others);
