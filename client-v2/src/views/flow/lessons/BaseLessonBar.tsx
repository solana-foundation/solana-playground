import type { FC } from "react";

import { BandControls } from "./BaseObjectiveBand";
import type { BaseObjectiveBandProps } from "./BaseObjectiveBand";
import { ObjectiveBar } from "@/shared/ui/objective-band";

const End: FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="ml-auto flex items-center gap-1">{children}</div>
);

/**
 * On a phone, what the band's step asks you to press, at the foot of the
 * code where the thumb is: back and on at the start, the page and the step's
 * action at the end. The band above folds to the ask alone.
 */
export const BaseLessonBar: FC<BaseObjectiveBandProps> = (props) => (
  <ObjectiveBar>
    <BandControls band={props} End={End} />
  </ObjectiveBar>
);
