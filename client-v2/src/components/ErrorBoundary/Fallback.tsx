import { FC } from "react";

import { FrownIcon } from "lucide-react";
import { Callout, CalloutDescription } from "@/shared/ui/callout";

interface FallbackProps {
  /** Error that was thrown */
  error: Error;
}

const Fallback: FC<React.PropsWithChildren<FallbackProps>> = ({ error }) => (
  <Callout variant="error">
    <FrownIcon />
    <CalloutDescription>
      <div>There was an unexpected error!</div>
      {error.message && <div>Reason: {error.message}</div>}
    </CalloutDescription>
  </Callout>
);

export default Fallback;
