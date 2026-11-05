import { Play } from "lucide-react";
import type { FC } from "react";

import { Button } from "@/shared/ui/button";
import { Spinner } from "@/shared/ui/spinner";

export interface BaseRunButtonProps {
  /** A run is in progress */
  running: boolean;
  /** The last run ended, whatever its outcome */
  ran: boolean;
  onRun: () => void;
}

/** The stage row's one action for a project with no program */
const BaseRunButton: FC<BaseRunButtonProps> = ({ running, ran, onRun }) => {
  let label = "Run";
  if (running) label = "Running…";
  else if (ran) label = "Run again";

  return (
    <Button id="flow-run" size="sm" disabled={running} onClick={onRun}>
      {running ? (
        <Spinner data-icon="inline-start" />
      ) : (
        <Play data-icon="inline-start" />
      )}
      {label}
    </Button>
  );
};

export default BaseRunButton;
