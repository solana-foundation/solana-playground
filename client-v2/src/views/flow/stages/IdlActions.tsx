import { ChangeEvent, FC, useState } from "react";
import styled, { css } from "styled-components";

import Button from "../../../components/Button";
import { useRenderOnChange } from "../../../hooks";
import { PgProgramInfo } from "../../../utils";

interface IdlActionsProps {
  showGenerate?: boolean;
  showUpload?: boolean;
}

/**
 * Labels promise no more than what happens in the browser: "Download IDL"
 * saves what the build already produced, "Load IDL file" replaces the IDL
 * this app uses -- neither touches the chain.
 */
const IdlActions: FC<React.PropsWithChildren<IdlActionsProps>> = ({
  showGenerate,
  showUpload,
}) => {
  const idl = useRenderOnChange(PgProgramInfo.onDidChangeIdl);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(
    null
  );

  const handleUpload = async (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      // The one field every consumer walks; a JSON file without it would
      // land in Interact as "corrupted IDL" -- refuse it at the door instead
      if (!Array.isArray(parsed.instructions)) {
        throw new Error("missing `instructions`");
      }
      PgProgramInfo.update({ idl: parsed });
      setNote({ text: `Using ${parsed.name ?? file.name}` });
    } catch (e) {
      console.error("Invalid IDL file", e);
      setNote({ text: "Not an Anchor IDL JSON file", error: true });
    }
  };

  return (
    <Row>
      {showGenerate && idl && (
        <Button.Export href={idl} fileName="idl.json">
          Download IDL
        </Button.Export>
      )}
      {showGenerate && !idl && (
        <Button disabled title="Build successfully first">
          Download IDL
        </Button>
      )}
      {showUpload && (
        <>
          <Button.Import
            accept=".json"
            title="Replaces the IDL this browser uses in Interact -- nothing is written on-chain"
            onImport={handleUpload}
          >
            Load IDL file
          </Button.Import>
          {note && <Note $error={note.error}>{note.text}</Note>}
        </>
      )}
    </Row>
  );
};

export default IdlActions;

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
`;

const Note = styled.span<{ $error?: boolean }>`
  ${({ theme, $error }) => css`
    font-size: ${theme.font.code.size.small};
    color: ${$error
      ? theme.colors.state.error.color
      : theme.colors.default.textSecondary};
  `}
`;
