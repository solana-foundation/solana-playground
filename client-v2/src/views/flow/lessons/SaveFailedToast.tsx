import type { FC } from "react";

/** Shown once a session, the first time a lesson's progress fails to save */
const SaveFailedToast: FC<React.PropsWithChildren<unknown>> = () => (
  <span>
    Lesson progress could not be saved. It is kept until you reload; the console
    has the details.
  </span>
);

export default SaveFailedToast;
