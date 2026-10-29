import type { FC } from "react";

import { BaseLessonBar } from "./BaseLessonBar";
import { bandProps } from "./ObjectiveBand";
import type { ObjectiveBandProps } from "./ObjectiveBand";

/** The phone's lesson bar, from the same props the band draws */
const LessonBar: FC<Omit<ObjectiveBandProps, "phone">> = (props) => {
  const band = bandProps({ ...props, phone: true });
  return band && <BaseLessonBar {...band} />;
};

export default LessonBar;
