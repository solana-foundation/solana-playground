import {
  ChangeEvent,
  ComponentProps,
  FC,
  PropsWithChildren,
  useRef,
  useState,
} from "react";

import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { Button } from "@/shared/ui/button";

interface ImportButtonProps {
  onImport: (ev: ChangeEvent<HTMLInputElement>) => Promise<void>;
  accept?: string;
  showImportText?: boolean;
  variant?: ComponentProps<typeof Button>["variant"];
  title?: string;
}

const ImportButton: FC<PropsWithChildren<ImportButtonProps>> = ({
  onImport,
  accept,
  variant = "outline",
  showImportText,
  title,
  children,
}) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const [importText, setImportText] = useState("");

  const handleClick = () => {
    inputRef.current?.click();
  };

  const handleChange = async (ev: ChangeEvent<HTMLInputElement>) => {
    // Read before the import runs: an import may reset the input, which
    // empties its file list
    const name = ev.target.files?.[0]?.name ?? "";
    try {
      await onImport(ev);
    } catch (error) {
      // The picker has no other way to say it failed, and the file name
      // below would claim it was imported
      reportButtonFailure("import the file")(error);
      setImportText("");
      // so the same file, once corrected, fires a change again
      ev.target.value = "";
      return;
    }
    setImportText(name);
  };

  return (
    <div className="flex items-center">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={handleChange}
        accept={accept}
      />
      <Button variant={variant} title={title} onClick={handleClick}>
        {children}
      </Button>
      {showImportText && importText && (
        <span className="ml-2 text-[0.75rem] text-[var(--text-secondary)]">
          {importText}
        </span>
      )}
    </div>
  );
};

export default ImportButton;
