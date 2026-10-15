import { FC, useState } from "react";
import styled from "styled-components";

import Button from "../../../../../components/Button";
import FilePicker from "../../../../../components/FilePicker";
import Input from "../../../../../components/Input";
import Link from "../../../../../components/Link";
import { ModalFrame, ModalPages, modalPage } from "@/widgets/overlays";
import type { ModalPageProps } from "@/widgets/overlays";
import Text from "../../../../../components/Text";
import { Checkmark, Sad } from "../../../../../components/Icons";
import { PgCommon, PgExplorer, PgRouter, PgShare } from "../../../../../utils";
import { createLogger } from "@/shared/lib/logger";

const log = createLogger("explorer:share");

export const Share = () => (
  <ModalPages name="share" defaultPage={modalPage(Default)} />
);

type DefaultProps = ModalPageProps;

const Default: FC<React.PropsWithChildren<DefaultProps>> = ({ setPage }) => {
  const [filePaths, setFilePaths] = useState(() =>
    Object.keys(PgExplorer.files).filter(
      (path) => PgExplorer.getItemTypeFromPath(path).file
    )
  );

  const share = async () => {
    try {
      const shareId = await PgCommon.transition(PgShare.new(filePaths));
      setPage(modalPage(SuccessPage, { shareId }));
    } catch (e: any) {
      // The error page tells the user; the team hears of it here
      log.error(e, { report: true });
      setPage(modalPage(ErrorPage, { message: e.message }));
    }
  };

  return (
    <ModalFrame
      name="share"
      title
      buttonProps={{
        text: "Share",
        onSubmit: share,
        disabled: !filePaths.length,
        noCloseOnSubmit: true,
      }}
    >
      <SelectFilesText>Select the files you'd like to share.</SelectFilesText>

      <FilePicker
        path={PgExplorer.getProjectRootPath()}
        filePaths={filePaths}
        setFilePaths={setFilePaths}
      />
    </ModalFrame>
  );
};

const SelectFilesText = styled.div`
  margin-bottom: 1rem;
`;

interface ErrorPageProps {
  message: string;
}

const ErrorPage: FC<React.PropsWithChildren<ErrorPageProps>> = ({
  message,
}) => (
  <ModalFrame name="share" title buttonProps={{ text: "Continue" }}>
    <Text kind="error" icon={<Sad />}>
      Share error: {message}
    </Text>
  </ModalFrame>
);

interface SuccessPageProps {
  shareId: string;
}

const SuccessPage: FC<React.PropsWithChildren<SuccessPageProps>> = ({
  shareId,
}) => {
  const shareLink = PgRouter.getPathUrl(shareId);

  return (
    <ModalFrame name="share" title buttonProps={{ text: "Continue" }}>
      <SuccessWrapper>
        <Text kind="success" icon={<Checkmark color="success" />}>
          Successfully shared the project.
        </Text>

        <SuccessInputWrapper>
          <Input value={shareLink} readOnly />
          <Button.Copy copyText={shareLink} />
        </SuccessInputWrapper>
        <SuccessLinkWrapper>
          <Link href={shareLink}>Go to the link</Link>
        </SuccessLinkWrapper>
      </SuccessWrapper>
    </ModalFrame>
  );
};

const SuccessWrapper = styled.div`
  min-width: 24rem;
`;

const SuccessInputWrapper = styled.div`
  display: flex;
  margin-top: 1rem;
  align-items: center;
`;

const SuccessLinkWrapper = styled.div`
  display: flex;
  justify-content: flex-start;
  margin-top: 0.75rem;
  margin-left: 0.25rem;
`;
