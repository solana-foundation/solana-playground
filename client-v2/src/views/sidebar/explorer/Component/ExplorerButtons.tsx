import { FC } from "react";

import Img from "../../../../components/Img";
import { PgExplorer, PgRouter } from "../../../../utils";
import { CreateItem } from "./Modals";
import { useCreateItem } from "./useCreateItem";
import { AsyncButton } from "@/shared/ui/async-button";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";

const ExplorerButtons = () => (
  <div
    className={cn(
      "flex justify-end px-2 py-1 [&_button]:my-2",
      // The icons are dark glyphs: half-inverted at rest, fully on hover in
      // the dark theme and plain in the light one
      "[&_button_img]:[filter:invert(0.5)] [&_button:hover_img]:[filter:invert(0)]",
      "dark:[&_button:hover_img]:[filter:invert(1)]"
    )}
  >
    <NewItemButton
      imageName="new_file.png"
      title="New file"
      failureAction="add a file"
    />
    <NewItemButton
      imageName="new_folder.png"
      title="New folder"
      failureAction="add a folder"
    />
    <CreateItem />
    <CollapseAllButton />
    {PgExplorer.isTemporary && <GoBackButton />}
  </div>
);

interface ButtonProps {
  imageName: string;
  title: string;
  /** What did not happen when the click fails, completing "Could not …" */
  failureAction: string;
}

const NewItemButton: FC<React.PropsWithChildren<ButtonProps>> = ({
  imageName,
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
      <Img
        src={getExplorerIconsPath(imageName)}
        alt={title}
        className="size-4"
      />
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
    <Img
      src={getExplorerIconsPath("collapse.png")}
      alt="Collapse folders"
      className="size-4"
    />
  </Button>
);

const GoBackButton = () => (
  <AsyncButton
    onClick={() => PgRouter.navigate()}
    onError={reportButtonFailure("go back to your projects")}
    variant="ghost"
    size="icon-sm"
    title="Go back to projects"
    loadingText={<span className="sr-only">Go back to your project</span>}
  >
    <Img
      src={getExplorerIconsPath("back.png")}
      alt="Go back to your project"
      className="size-4"
    />
  </AsyncButton>
);

const getExplorerIconsPath = (name: string) => "/icons/explorer/" + name;

export default ExplorerButtons;
