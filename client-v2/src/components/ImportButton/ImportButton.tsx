import {
  ChangeEvent,
  ComponentProps,
  FC,
  PropsWithChildren,
  useRef,
  useState,
} from "react";
import styled, { css } from "styled-components";

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
    <Wrapper>
      <input
        ref={inputRef}
        type="file"
        onChange={handleChange}
        accept={accept}
      />
      <Button variant={variant} title={title} onClick={handleClick}>
        {children}
      </Button>
      {showImportText && importText && <ImportInfo>{importText}</ImportInfo>}
    </Wrapper>
  );
};

const Wrapper = styled.div`
  display: flex;
  align-items: center;

  & input[type="file"] {
    display: none;
  }
`;

const ImportInfo = styled.span`
  ${({ theme }) => css`
    color: ${theme.colors.default.textSecondary};
    font-size: ${theme.font.code.size.small};
    margin-left: 0.5rem;
  `}
`;

export default ImportButton;
