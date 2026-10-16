import { FC } from "react";

import Text from "../Text";
import { Sad } from "../Icons";

interface FallbackProps {
  /** Error that was thrown */
  error: Error;
}

const Fallback: FC<React.PropsWithChildren<FallbackProps>> = ({ error }) => (
  <Text kind="error" icon={<Sad />}>
    <div>There was an unexpected error!</div>
    {error.message && <div>Reason: {error.message}</div>}
  </Text>
);

export default Fallback;
