import type { FC } from "react";

import { BandControls } from "./BaseObjectiveBand";
import type { BaseObjectiveBandProps } from "./BaseObjectiveBand";
import { ObjectiveBar } from "@/shared/ui/objective-band";

/* A later hint's label is long: on a narrow phone the action drops under the
   page rather than past the screen's edge */
const End: FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1 py-1.5">
    {children}
  </div>
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
