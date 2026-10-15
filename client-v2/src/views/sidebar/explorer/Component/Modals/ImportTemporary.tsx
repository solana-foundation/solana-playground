import { useState } from "react";
import styled from "styled-components";

import Input from "../../../../../components/Input";
import { ModalFrame } from "@/widgets/overlays";
import { PgExplorer } from "../../../../../utils";

export const ImportTemporary = () => {
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  const importTemporary = async () => {
    await PgExplorer.createWorkspace(name, { fromTemporary: true });
  };

  return (
    <ModalFrame
      name="import-temporary"
      title
      buttonProps={{
        text: "Import",
        onSubmit: importTemporary,
        disabled: !!error,
      }}
    >
      <MainText>Project name</MainText>
      <Input
        autoFocus
        value={name}
        onChange={(ev) => setName(ev.target.value)}
        validator={PgExplorer.isWorkspaceNameValid}
        error={error}
        setError={setError}
        placeholder="project name..."
      />
    </ModalFrame>
  );
};

const MainText = styled.div`
  margin-bottom: 0.5rem;
  font-weight: bold;
`;
