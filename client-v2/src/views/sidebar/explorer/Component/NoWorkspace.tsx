import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { AsyncButton } from "@/shared/ui/async-button";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import { Icon } from "@/shared/ui/icon";

import { PgView } from "../../../../utils";
import { CreateWorkspace } from "./Modals";

const NoWorkspace = () => {
  const createWorkspace = () => PgView.setModal(CreateWorkspace);

  return (
    <div className="flex flex-col justify-center px-4 py-6 [&>button]:mt-4">
      <Callout>
        <CalloutDescription>
          Start by creating a new project.
        </CalloutDescription>
      </Callout>
      <AsyncButton
        variant="outline"
        onClick={createWorkspace}
        onError={reportButtonFailure("create a project")}
        className="w-full"
      >
        <Icon name="add" data-icon="inline-start" />
        Create a new project
      </AsyncButton>
    </div>
  );
};

export default NoWorkspace;
