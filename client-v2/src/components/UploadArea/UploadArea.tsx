import { FC } from "react";
import { DropzoneOptions, DropzoneState, useDropzone } from "react-dropzone";

import Input from "../Input";
import { Checkmark, Upload } from "../Icons";
import { PgCommon } from "../../utils";
import { cn } from "@/shared/lib/utils";

interface UploadAreaProps extends DropzoneOptions {
  /** Callback to run on drop or import */
  onDrop: (files: any) => Promise<void>;
  /** Error message to show */
  error: string;
  /** Default message to show */
  text?: string;
  /** The amount of files that are uploaded */
  filesLength?: number;
  className?: string;
}

const UploadArea: FC<React.PropsWithChildren<UploadAreaProps>> = ({
  className,
  ...props
}) => {
  const { getRootProps, getInputProps, isDragActive } = useDropzone(props);

  return (
    <div
      {...getRootProps()}
      className={cn(
        "flex flex-col items-center justify-center rounded-[12px] p-8 [transition:all_50ms_linear]",
        "border-2 border-dashed border-[color-mix(in_srgb,var(--primary)_39%,transparent)] bg-[color-mix(in_srgb,var(--primary)_9%,transparent)]",
        "hover:cursor-pointer hover:border-[color-mix(in_srgb,var(--primary)_73%,transparent)] hover:[&>div]:text-[var(--text-primary)]",
        "[&>svg]:h-16 [&>svg]:w-16 [&>svg]:text-primary",
        isDragActive ? "opacity-[0.55]" : "opacity-100",
        className
      )}
    >
      <Input {...getInputProps()} />
      <Upload />
      <ImportResult isDragActive={isDragActive} {...props} />
    </div>
  );
};

type ImportResultProps = Pick<
  UploadAreaProps,
  "error" | "filesLength" | "text"
> &
  Pick<DropzoneState, "isDragActive"> &
  Pick<DropzoneOptions, "noClick">;

const ImportResult: FC<React.PropsWithChildren<ImportResultProps>> = ({
  error,
  text,
  filesLength,
  isDragActive,
  noClick,
}) => {
  if (error) {
    return (
      <div>
        <ImportResultText result="error">{error}</ImportResultText>
      </div>
    );
  }

  if (filesLength) {
    return (
      <div>
        <ImportResultText result="success">
          <Checkmark />
          Imported {filesLength} {PgCommon.makePlural("file", filesLength)}.
        </ImportResultText>
      </div>
    );
  }

  if (isDragActive) return <ImportResultText>Drop here</ImportResultText>;

  return (
    <ImportResultText>
      {text ?? (noClick ? "Drop files" : "Select or drop files")}
    </ImportResultText>
  );
};

const RESULT_CLASSES = {
  error: "text-error",
  success: "text-primary",
};

const ImportResultText: FC<
  React.PropsWithChildren<{ result?: keyof typeof RESULT_CLASSES }>
> = ({ result, children }) => (
  <div
    className={cn(
      "mt-4 flex items-center font-bold text-[var(--text-secondary)] [&>svg]:mr-2",
      result && RESULT_CLASSES[result]
    )}
  >
    {children}
  </div>
);

export default UploadArea;
