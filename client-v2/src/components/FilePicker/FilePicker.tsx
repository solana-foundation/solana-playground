import { Dispatch, FC, SetStateAction, useCallback, useMemo } from "react";
import styled, { css } from "styled-components";

import { Checkbox } from "@/shared/ui/checkbox";
import { Label } from "@/shared/ui/label";
import LangIcon from "../LangIcon";
import { PgCommon, PgExplorer } from "../../utils";
import { useDifferentBackground } from "../../hooks";

interface FilePickerProps {
  path: string;
  filePaths: string[];
  setFilePaths: Dispatch<SetStateAction<string[]>>;
}

const FilePicker: FC<React.PropsWithChildren<FilePickerProps>> = ({
  path,
  filePaths,
  setFilePaths,
}) => {
  const ref = useDifferentBackground();

  return (
    <Wrapper ref={ref}>
      <RecursiveFolder
        path={path}
        filePaths={filePaths}
        setFilePaths={setFilePaths}
      />
    </Wrapper>
  );
};

const Wrapper = styled.div`
  padding: 0.5rem 0;
  border-radius: ${({ theme }) => theme.default.borderRadius};
`;

type RecursiveFolderProps = FilePickerProps;

/** Get the paths of every file in the folder, subfolders included */
const getFilePathsIn = (folderPath: string): string[] => {
  const { files, folders } = PgExplorer.getFolderContent(folderPath);
  return [
    ...files.map((name) => PgCommon.joinPaths(folderPath, name)),
    ...folders.flatMap((name) =>
      getFilePathsIn(PgCommon.joinPaths(folderPath, name, "/"))
    ),
  ];
};

const RecursiveFolder: FC<React.PropsWithChildren<RecursiveFolderProps>> = ({
  path,
  filePaths,
  setFilePaths,
}) => {
  const folderName = useMemo(
    () => PgExplorer.getItemNameFromPath(path),
    [path]
  );

  const depth = useMemo(
    () => PgExplorer.getRelativePath(path).split("/").length - 1,
    [path]
  );

  const { files, folders } = useMemo(
    () => PgExplorer.getFolderContent(path),
    [path]
  );

  // A folder reads as checked while any file under it is
  const isChecked = (itemPath: string) =>
    filePaths.some((filePath) => filePath.startsWith(itemPath));

  const toggleCheck = useCallback(
    (itemPath: string, checked: boolean) => {
      const paths = PgExplorer.getItemTypeFromPath(itemPath).file
        ? [itemPath]
        : getFilePathsIn(itemPath);

      setFilePaths((previousPaths) => {
        if (checked) {
          return [
            ...previousPaths,
            ...paths.filter((p) => !previousPaths.includes(p)),
          ];
        }
        return previousPaths.filter((p) => !paths.includes(p));
      });
    },
    [setFilePaths]
  );

  return (
    <Folder>
      <FolderName>
        <StyledLabel $depth={depth}>
          <Checkbox
            checked={isChecked(path)}
            onCheckedChange={(checked) => toggleCheck(path, checked === true)}
          />
          {folderName}
        </StyledLabel>
      </FolderName>

      {folders
        .sort((a, b) => {
          // Prioritize `src` dir
          if (b === PgExplorer.PATHS.SRC_DIRNAME) return 1;
          return a.localeCompare(b);
        })
        .map((name) => (
          <RecursiveFolder
            key={name}
            path={PgCommon.joinPaths(path, name, "/")}
            filePaths={filePaths}
            setFilePaths={setFilePaths}
          />
        ))}

      {files
        .sort((a, b) => a.localeCompare(b))
        .map((name) => (
          <File key={name}>
            <StyledLabel $depth={depth + 1}>
              <Checkbox
                checked={isChecked(PgCommon.joinPaths(path, name))}
                onCheckedChange={(checked) =>
                  toggleCheck(PgCommon.joinPaths(path, name), checked === true)
                }
              />
              <FileNameWrapper>
                <LangIcon path={name} />
                <FileName>{name}</FileName>
              </FileNameWrapper>
            </StyledLabel>
          </File>
        ))}
    </Folder>
  );
};

const Folder = styled.div`
  ${({ theme }) => css`
    & label {
      width: 100%;
      transition: all ${theme.default.transition.duration.short}
        ${theme.default.transition.type};

      &:hover {
        background: ${theme.colors.state.hover.bg};
      }
    }
  `}
`;

const FolderName = styled.div`
  display: flex;
`;

const File = styled.div`
  display: flex;
  align-items: center;
`;

const FileNameWrapper = styled.div`
  display: flex;
  align-items: center;
`;

const FileName = styled.span`
  margin-left: 0.25rem;
`;

const StyledLabel = styled(Label)<{ $depth: number }>`
  margin-left: ${({ $depth }) => $depth + 1}rem;
  padding: 0.375rem 0.5rem;
  height: 2rem;
`;

export default FilePicker;
