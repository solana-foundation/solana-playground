import { InfoIcon } from "lucide-react";
import { FC, useState } from "react";

import { Callout, CalloutDescription } from "@/shared/ui/callout";
import { FieldError } from "@/shared/ui/field";
import { ModalFrame } from "@/widgets/overlays";

import Input from "../../../../../components/Input";
import UploadArea from "../../../../../components/UploadArea";
import { useMounted } from "../../../../../hooks";
import {
  PgExplorer,
  PgFramework,
  PgView,
  TupleFiles,
} from "../../../../../utils";
import { IMPORTED } from "./imported";
import { useLimitRefusal } from "./useLimitRefusal";

interface ImportFsProps {
  name?: string;
  files?: TupleFiles;
  importError?: string;
}

export const ImportFs: FC<React.PropsWithChildren<ImportFsProps>> = (props) => {
  // Handle user input
  const [name, setName] = useState(props.name ?? "");
  const [files, setFiles] = useState(props.files);
  const [nameError, setNameError] = useState("");
  const [importError, setImportError] = useState(props.importError ?? "");
  const { limitError, guard } = useLimitRefusal();

  const mounted = useMounted();

  const onDrop = async (userFiles: Array<File & { path: string }>) => {
    try {
      const importFiles: TupleFiles = [];
      for (const userFile of userFiles) {
        const shouldSkip = /(\/\.|node_modules|target)/.test(userFile.path);
        if (shouldSkip) continue;

        const content = await userFile.text();
        importFiles.push([userFile.path, content]);
      }

      // A dropped folder's name leads every path; a project with no program
      // drops it rather than nest the project under it
      const folders = new Set(
        importFiles.map(([path]) => /^\/?([^/]+)\//.exec(path)?.[1])
      );
      const [root] = folders.size === 1 ? [...folders] : [];
      const pgFiles = await PgFramework.convertToPlaygroundLayoutWith(
        root ?? ""
      )(root)(importFiles);

      // Closed while the files were read: open it again with them
      if (!mounted.current) {
        PgView.setModal(<ImportFs name={name} files={pgFiles} />);
      } else {
        setFiles(pgFiles);
        setImportError("");
      }
    } catch (e: any) {
      if (!mounted.current) {
        PgView.setModal(<ImportFs name={name} importError={e.message} />);
      } else {
        setImportError(e.message);
      }
    }
  };

  return (
    <ModalFrame
      name="import-fs"
      title="Import project"
      buttonProps={{
        text: "Import",
        onSubmit: guard(async () => {
          await PgExplorer.createWorkspace(name, { files });
          return IMPORTED;
        }),
        disabled: !files || !!nameError || !!importError,
      }}
    >
      <div className="flex flex-col justify-center">
        <FieldError data-testid="explorer-limit-error" className="mb-2">
          {limitError}
        </FieldError>
        <div className="mb-1">
          <div className="mb-2 font-bold">Project name</div>
          <Input
            autoFocus
            value={name}
            onChange={(ev) => setName(ev.target.value)}
            validator={PgExplorer.isWorkspaceNameValid}
            error={nameError}
            setError={setNameError}
            placeholder="my local project..."
          />
        </div>

        <div className="mt-4">
          <UploadArea
            onDrop={onDrop}
            error={importError}
            filesLength={files?.length}
            text="Drop a program or a workspace"
          />
        </div>

        <Callout variant="info" className="mt-4">
          <InfoIcon />
          <CalloutDescription>
            You can drag & drop a Cargo workspace directory.
          </CalloutDescription>
        </Callout>
      </div>
    </ModalFrame>
  );
};
