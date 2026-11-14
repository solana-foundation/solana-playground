import { FlaskConical, Plus } from "lucide-react";
import type { FC, ReactNode } from "react";

import { AsyncButton } from "@/shared/ui/async-button";
import { Badge } from "@/shared/ui/badge";

export interface BaseClientProjectBarProps {
  /** The cluster the project runs on; none while the endpoint is unread */
  cluster?: string;
  /** Scaffolds a program, which brings the stages back */
  onAddProgram: () => Promise<unknown>;
  onAddProgramError: (error: unknown) => void;
  onTest: () => Promise<unknown>;
  onTestError: (error: unknown) => void;
  /** The connected Run button */
  run: ReactNode;
}

/**
 * A client project's row at the top of the work, in place of a stepper that
 * would hold one lone Write tab: the "Client project" label with its
 * cluster, then Add program, Test and Run. 44 px like the assistant's head,
 * so their lines meet.
 */
const BaseClientProjectBar: FC<BaseClientProjectBarProps> = ({
  cluster,
  onAddProgram,
  onAddProgramError,
  onTest,
  onTestError,
  run,
}) => (
  <div className="flex h-11 min-w-0 shrink-0 items-center gap-2 border-b border-border px-3 font-sans">
    <Badge variant="outline" id="flow-client-project">
      Client project
    </Badge>
    {cluster && (
      <span
        id="flow-client-cluster"
        className="truncate text-sm text-muted-foreground"
      >
        {cluster}
      </span>
    )}
    <div className="ml-auto flex shrink-0 items-center gap-2">
      <AsyncButton
        id="flow-add-program"
        variant="ghost"
        size="sm"
        onClick={onAddProgram}
        onError={onAddProgramError}
      >
        <Plus data-icon="inline-start" />
        Add program
      </AsyncButton>
      <AsyncButton
        id="flow-test"
        variant="outline"
        size="sm"
        onClick={onTest}
        onError={onTestError}
      >
        <FlaskConical data-icon="inline-start" />
        Test
      </AsyncButton>
      {run}
    </div>
  </div>
);

export default BaseClientProjectBar;
