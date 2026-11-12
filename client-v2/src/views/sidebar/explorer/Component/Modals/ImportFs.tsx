import { InfoIcon } from "lucide-react";
import { FC, useState } from "react";

import { trackImport, trackImportFailure } from "@/features/project-files";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import { FieldError } from "@/shared/ui/field";
import { ModalFrame } from "@/widgets/overlays";

import Input from "../../../../../components/Input";
import UploadArea from "../../../../../components/UploadArea";
import { useMounted } from "../../../../../hooks";
import {
  ImportedFile,
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

  const onDrop = async (userFiles: ImportedFile[]) => {
    try {
      const pgFiles = await PgFramework.importFiles(userFiles);

      // Closed while the files were read: open it again with them
      if (!mounted.current) {
        PgView.setModal(<ImportFs name={name} files={pgFiles} />);
      } else {
        setFiles(pgFiles);
        setImportError("");
      }
    } catch (e) {
      trackImportFailure("files", e);
      // Something thrown that is not an `Error` must still say it failed
      const message =
        e instanceof Error && e.message
          ? e.message
          : "Could not read the files.";
      if (!mounted.current) {
        PgView.setModal(<ImportFs name={name} importError={message} />);
      } else {
        setImportError(message);
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
          await trackImport(
            () => PgExplorer.createWorkspace(name, { files }),
            "files"
          );
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
