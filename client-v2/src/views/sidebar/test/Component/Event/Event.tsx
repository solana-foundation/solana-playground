import { FC, useEffect, useState } from "react";

import { useConnection, useWallet } from "../../../../../hooks";
import { PgCommon } from "../../../../../utils";
import { PgProgramInteraction } from "../../../../../utils/program-interaction";
import CodeResult from "../CodeResult";
import { useIdl } from "../IdlProvider";
import Interaction from "../Interaction";

interface EventProps {
  eventName: string;
}

const Event: FC<React.PropsWithChildren<EventProps>> = ({ eventName }) => {
  const connection = useConnection();
  const wallet = useWallet();
  const { idl } = useIdl();

  const [receivedEvents, setReceivedEvents] = useState<object[]>([]);

  useEffect(() => {
    if (!(idl && connection && wallet)) return;

    const program = PgProgramInteraction.getAnchorProgram();
    const listener = program.addEventListener(eventName, (emittedEvent) => {
      setReceivedEvents((eventsSoFar) => [...eventsSoFar, emittedEvent]);
    });

    return () => {
      program.removeEventListener(listener);
    };
  }, [eventName, idl, connection, wallet]);

  return (
    <Interaction name={`${eventName} (${receivedEvents.length})`}>
      <CodeResult>
        {receivedEvents.map((ev) => PgCommon.prettyJSON(ev)).join("\n")}
      </CodeResult>
    </Interaction>
  );
};

export default Event;
