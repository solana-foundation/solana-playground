import { FC } from "react";
import styled from "styled-components";

import Img from "../../../../components/Img";
import { PgExplorer, PgRouter } from "../../../../utils";
import { CreateItem } from "./Modals";
import { useCreateItem } from "./useCreateItem";
import { AsyncButton } from "@/shared/ui/async-button";
import { Button } from "@/shared/ui/button";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";

const ExplorerButtons = () => (
  <ButtonsWrapper>
    <NewItemButton imageName="new_file.png" title="New file" />
    <NewItemButton imageName="new_folder.png" title="New folder" />
    <CreateItem />
    <CollapseAllButton />
    {PgExplorer.isTemporary && <GoBackButton />}
  </ButtonsWrapper>
);

const ButtonsWrapper = styled.div`
  display: flex;
  justify-content: flex-end;
  padding: 0.25rem 0.5rem;

  & button {
    margin: 0.5rem 0;
  }

  & button img {
    filter: invert(0.5);
  }

  & button:hover img {
    filter: invert(${({ theme }) => (theme.isDark ? 1 : 0)});
  }
`;

interface ButtonProps {
  imageName: string;
  title: string;
}

const NewItemButton: FC<React.PropsWithChildren<ButtonProps>> = ({
  imageName,
  title,
}) => {
  const { createItem } = useCreateItem();

  return (
    <AsyncButton
      onClick={createItem}
      onError={reportButtonFailure}
      variant="ghost"
      size="icon-sm"
      title={title}
      loadingText={<span className="sr-only">{title}</span>}
    >
      <Img src={getExplorerIconsPath(imageName)} alt={title} />
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
    <Img src={getExplorerIconsPath("collapse.png")} alt="Collapse folders" />
  </Button>
);

const GoBackButton = () => (
  <AsyncButton
    onClick={() => PgRouter.navigate()}
    onError={reportButtonFailure}
    variant="ghost"
    size="icon-sm"
    title="Go back to projects"
    loadingText={<span className="sr-only">Go back to your project</span>}
  >
    <Img
      src={getExplorerIconsPath("back.png")}
      alt="Go back to your project"
      style={{ height: "0.875rem", width: "0.875rem" }}
    />
  </AsyncButton>
);

const getExplorerIconsPath = (name: string) => "/icons/explorer/" + name;

export default ExplorerButtons;
