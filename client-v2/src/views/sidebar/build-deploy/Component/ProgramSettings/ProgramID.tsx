import { ChangeEvent, useEffect, useState } from "react";
import { TriangleAlertIcon } from "lucide-react";
import styled, { css } from "styled-components";

import ImportButton from "../../../../../components/ImportButton";
import Input from "../../../../../components/Input";
import { ModalFrame } from "@/widgets/overlays";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import { Warning } from "../../../../../components/Icons";
import { PgProgramInfo, PgCommon, PgView, PgWeb3 } from "../../../../../utils";
import { useRenderOnChange } from "../../../../../hooks";
import { AsyncButton } from "@/shared/ui/async-button";
import { Button } from "@/shared/ui/button";
import { CopyButton } from "@/shared/ui/copy-button";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";

const ProgramID = () => (
  <Wrapper>
    <ButtonsWrapper>
      <New />
      <Import />
      <Export />
    </ButtonsWrapper>
    <InputPk />
  </Wrapper>
);

const New = () => {
  const handleNew = async () => {
    if (PgProgramInfo.kp) {
      await PgView.setModal(NewKeypairModal);
    } else {
      PgProgramInfo.update({ kp: PgWeb3.Keypair.generate() });
    }
  };

  return (
    <AsyncButton
      variant="outline"
      onClick={handleNew}
      onError={reportButtonFailure}
    >
      New
    </AsyncButton>
  );
};

const NewKeypairModal = () => {
  const generateNewKeypair = () => {
    PgProgramInfo.update({
      kp: PgWeb3.Keypair.generate(),
      customPk: null,
    });
  };

  return (
    <ModalFrame
      name="program-id"
      title
      buttonProps={{
        text: "Generate",
        onSubmit: generateNewKeypair,
      }}
    >
      <MainContent>
        <MainText>
          Are you sure you want to create a new program keypair?
        </MainText>
        <Desc>This will create a brand new keypair for your program.</Desc>
        <Callout variant="warning" className="mt-4">
          <TriangleAlertIcon />
          <CalloutDescription>
            The old keypair will be lost if you don't save it.
          </CalloutDescription>
        </Callout>
        <Button asChild variant="outline" className="w-fit">
          <a
            href={PgCommon.getDataUrl(Array.from(PgProgramInfo.kp!.secretKey))}
            download="program-keypair.json"
          >
            Save keypair
          </a>
        </Button>
      </MainContent>
    </ModalFrame>
  );
};

const Import = () => {
  const handleImport = async (ev: ChangeEvent<HTMLInputElement>) => {
    const files = ev.target.files;
    if (!files?.length) return;

    // A file that is not a keypair throws; ImportButton reports it
    const bytes = Uint8Array.from(JSON.parse(await files[0].text()));
    if (bytes.length !== 64) throw new Error("Invalid keypair");

    // Override customPk when user imports a new keypair
    PgProgramInfo.update({
      kp: PgWeb3.Keypair.fromSecretKey(bytes),
      customPk: null,
    });

    // Reset file
    ev.target.value = "";
  };

  return (
    <ImportButton accept=".json" onImport={handleImport}>
      Import
    </ImportButton>
  );
};

const Export = () => {
  const kp = useRenderOnChange(PgProgramInfo.onDidChangeKp);
  const customPk = useRenderOnChange(PgProgramInfo.onDidChangeCustomPk);
  if (!kp || customPk) return null;

  return (
    <Button asChild variant="outline" className="w-fit">
      <a
        href={PgCommon.getDataUrl(Array.from(kp.secretKey))}
        download="program-keypair.json"
      >
        Export
      </a>
    </Button>
  );
};

interface UpdateInfoProps {
  text?: string;
  error?: boolean;
  changed?: boolean;
}

const InputPk = () => {
  const [val, setVal] = useState("");
  const [updateInfo, setUpdateInfo] = useState<UpdateInfoProps>({});

  useEffect(() => {
    const { dispose } = PgProgramInfo.onDidChangePk((pk) => {
      if (pk) setVal(pk.toBase58());
    });
    return dispose;
  }, []);

  const handleChange = (ev: ChangeEvent<HTMLInputElement>) => {
    setVal(ev.target.value);
    setUpdateInfo({ changed: true });
  };

  const handleClick = () => {
    try {
      PgProgramInfo.update({ customPk: new PgWeb3.PublicKey(val) });
      setUpdateInfo({ text: "Updated program ID" });
    } catch {
      setUpdateInfo({ text: "Invalid public key", error: true });
    }
  };

  const handleRemoveCustomProgramId = () => {
    PgProgramInfo.update({ customPk: null });
    setUpdateInfo({ text: "Removed custom ID" });
  };

  return (
    <InputPkWrapper>
      <InputLabelWrapper>
        <InputLabel>Program ID:</InputLabel>
        {updateInfo.text && (
          <UpdateInfo error={updateInfo.error}>{updateInfo.text}</UpdateInfo>
        )}
      </InputLabelWrapper>

      <InputWrapper>
        <Input
          value={val}
          onChange={handleChange}
          validator={PgCommon.isPk}
          placeholder="Your program's public key"
        />
        <CopyButton value={val} onError={reportButtonFailure} />
      </InputWrapper>
      <InputWarning>
        <Warning color="warning" />
        Only the authority can upgrade.
      </InputWarning>
      {updateInfo.changed && (
        <Button variant="outline" onClick={handleClick}>
          Change program ID
        </Button>
      )}

      {!!PgProgramInfo.customPk && (
        <Button variant="outline" onClick={handleRemoveCustomProgramId}>
          Remove custom program ID
        </Button>
      )}
    </InputPkWrapper>
  );
};

const Wrapper = styled.div`
  & > div:first-child > * {
    margin-right: 1rem;
  }
`;

const ButtonsWrapper = styled.div`
  display: flex;
`;

const MainContent = styled.div`
  display: flex;
  flex-direction: column;
  padding: 0 1rem;

  & > a {
    margin-top: 1rem;
  }
`;
const MainText = styled.span`
  font-weight: bold;
`;

const Desc = styled.span`
  ${({ theme }) => css`
    font-size: ${theme.font.code.size.small};
    color: ${theme.colors.default.textSecondary};
    margin-top: 0.5rem;
  `}
`;

const InputPkWrapper = styled.div`
  margin-top: 1rem;

  & > button {
    margin-top: 0.5rem;
  }
`;

const InputLabelWrapper = styled.div`
  margin-bottom: 0.375rem;
  font-size: ${({ theme }) => theme.font.code.size.small};
`;

const InputLabel = styled.span`
  margin-bottom: 0.375rem;
  font-size: ${({ theme }) => theme.font.code.size.small};
`;

const UpdateInfo = styled.span<UpdateInfoProps>`
  ${({ theme, error }) => css`
    margin-left: 0.375rem;
    font-size: ${theme.font.code.size.small};
    color: ${error
      ? theme.colors.state.error.color
      : theme.colors.state.success.color};
  `}
`;

const InputWrapper = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
`;

const InputWarning = styled.div`
  ${({ theme }) => css`
    margin-top: 0.5rem;
    font-size: ${theme.font.code.size.small};
    color: ${theme.colors.default.textSecondary};

    & > svg {
      margin-right: 0.375rem;
    }
  `}
`;

export default ProgramID;
