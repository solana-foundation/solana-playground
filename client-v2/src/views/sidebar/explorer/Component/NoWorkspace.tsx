import { Callout, CalloutDescription } from "@/shared/ui/callout";
import { CreateWorkspace } from "./Modals";
import { Plus } from "../../../../components/Icons";
import { PgView } from "../../../../utils";
import { AsyncButton } from "@/shared/ui/async-button";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";

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
        <Plus data-icon="inline-start" />
        Create a new project
      </AsyncButton>
    </div>
  );
};

export default NoWorkspace;
