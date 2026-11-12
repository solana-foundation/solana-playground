import {
  FilePlus,
  FolderPlus,
  LucideIcon,
  Minimize2,
  Undo2,
} from "lucide-react";
import { FC } from "react";

import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { cn } from "@/shared/lib/utils";
import { AsyncButton } from "@/shared/ui/async-button";
import { Button } from "@/shared/ui/button";

import { PgExplorer, PgRouter } from "../../../../utils";
import { CreateItem } from "./Modals";
import { useCreateItem } from "./useCreateItem";

const ExplorerButtons = () => (
  <div
    className={cn(
      "flex justify-end px-2 py-1 [&_button]:my-2",
      // Muted at rest; the ghost button's hover brings the foreground colour
      "[&_button]:text-muted-foreground"
    )}
  >
    <NewItemButton
      Icon={FilePlus}
      title="New file"
      failureAction="add a file"
    />
    <NewItemButton
      Icon={FolderPlus}
      title="New folder"
      failureAction="add a folder"
    />
    <CreateItem />
    <CollapseAllButton />
    {PgExplorer.isTemporary && <GoBackButton />}
  </div>
);

interface ButtonProps {
  Icon: LucideIcon;
  title: string;
  /** What did not happen when the click fails, completing "Could not …" */
  failureAction: string;
}

const NewItemButton: FC<React.PropsWithChildren<ButtonProps>> = ({
  Icon,
  title,
  failureAction,
}) => {
  const { createItem } = useCreateItem();

  return (
    <AsyncButton
      onClick={createItem}
      onError={reportButtonFailure(failureAction)}
      variant="ghost"
      size="icon-sm"
      title={title}
      loadingText={<span className="sr-only">{title}</span>}
    >
      <Icon className="size-4" />
    </AsyncButton>
  );
};

const CollapseAllButton = () => (
  <Button
    onClick={() => PgExplorer.collapseAllFolders()}
    variant="ghost"
    size="icon-sm"
    title="Collapse folders"
  >
    <Minimize2 className="size-4" />
  </Button>
);

const GoBackButton = () => (
  <AsyncButton
    onClick={() => PgRouter.navigate()}
    onError={reportButtonFailure("go back to your projects")}
    variant="ghost"
    size="icon-sm"
    title="Go back to projects"
    // The button's name; without it `title` would rename the button
    aria-label="Go back to your project"
    loadingText={<span className="sr-only">Go back to your project</span>}
  >
    <Undo2 className="size-4" />
  </AsyncButton>
);

export default ExplorerButtons;
