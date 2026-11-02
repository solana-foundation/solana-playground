import type { FC } from "react";

/** Shown once when a tutorial's saved progress could not be read */
const LoadFailedToast: FC<React.PropsWithChildren<unknown>> = () => (
  <span>
    Your saved progress for this tutorial could not be read, so this session is
    not being saved. Start over resets it; the console has the details.
  </span>
);

export default LoadFailedToast;
