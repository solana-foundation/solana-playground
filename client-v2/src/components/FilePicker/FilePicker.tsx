import { Dispatch, FC, SetStateAction, useCallback, useMemo } from "react";

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
    <div ref={ref} className="rounded-[12px] py-2">
      <RecursiveFolder
        path={path}
        filePaths={filePaths}
        setFilePaths={setFilePaths}
      />
    </div>
  );
};

const LABEL_CLASSES = "h-8 px-2 py-1.5";

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
    <div className="[&_label:hover]:bg-surface-hover [&_label]:w-full [&_label]:[transition:all_50ms_linear]">
      <div className="flex">
        <Label
          className={LABEL_CLASSES}
          style={{ marginLeft: `${depth + 1}rem` }}
        >
          <Checkbox
            checked={isChecked(path)}
            onCheckedChange={(checked) => toggleCheck(path, checked === true)}
          />
          {folderName}
        </Label>
      </div>

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
          <div key={name} className="flex items-center">
            <Label
              className={LABEL_CLASSES}
              style={{ marginLeft: `${depth + 2}rem` }}
            >
              <Checkbox
                checked={isChecked(PgCommon.joinPaths(path, name))}
                onCheckedChange={(checked) =>
                  toggleCheck(PgCommon.joinPaths(path, name), checked === true)
                }
              />
              <div className="flex items-center">
                <LangIcon path={name} />
                <span className="ml-1">{name}</span>
              </div>
            </Label>
          </div>
        ))}
    </div>
  );
};

export default FilePicker;
