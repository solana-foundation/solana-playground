import { FC } from "react";
import styled, { css } from "styled-components";

import Button from "../../../../../components/Button";
import Markdown from "../../../../../components/Markdown";
import { ModalFrame, ModalPages, modalPage } from "@/widgets/overlays";
import type { ModalPageProps } from "@/widgets/overlays";
import Text from "../../../../../components/Text";
import { ExportFile, Info } from "../../../../../components/Icons";
import { PgFramework, PgView } from "../../../../../utils";
import { createLogger } from "@/shared/lib/logger";

const log = createLogger("explorer:export-workspace");

export const ExportWorkspace = () => (
  <ModalPages name="export-workspace" defaultPage={modalPage(Default)} />
);

type DefaultProps = ModalPageProps;

const Default: FC<React.PropsWithChildren<DefaultProps>> = ({ setPage }) => {
  const convertAndExport = async () => {
    try {
      const { readme } = await PgFramework.exportWorkspace({ convert: true });
      setPage(modalPage(Readme, { readme }));
    } catch (e) {
      // The export still happens, as is; the user hears that the layout
      // stayed, and the team hears why the conversion failed
      log.error(e, { report: true });
      PgView.setToast(
        () => <span>Could not convert the layout; exported it as is.</span>,
        { options: { name: "export-convert-failed" } }
      );
      await exportWithoutChanges();
    }
  };

  const exportWithoutChanges = async () => {
    await PgFramework.exportWorkspace();
    PgView.closeModal();
  };

  return (
    <ModalFrame name="export-workspace" title="Export project">
      <Content>
        <Question>Convert the project layout?</Question>

        <Description>
          Playground uses a different layout than the framework's default
          layout.
        </Description>

        <Description>
          To make the project work locally, playground can make the necessary
          conversion before exporting.
        </Description>

        <InfoText icon={<Info color="info" />}>
          Conversion may involve modifying JS/TS code to make the code work in
          local Node environment.
        </InfoText>

        <ButtonsWrapper>
          <Button
            onClick={convertAndExport}
            kind="primary-transparent"
            rightIcon={<ExportFile />}
          >
            Convert and export
          </Button>
          <Button onClick={exportWithoutChanges} rightIcon={<ExportFile />}>
            Export without changes
          </Button>
        </ButtonsWrapper>
      </Content>
    </ModalFrame>
  );
};

const Content = styled.div`
  max-width: 26rem;
`;

const Question = styled.p`
  font-weight: bold;
`;

const Description = styled.p`
  ${({ theme }) => css`
    color: ${theme.colors.default.textSecondary};
    font-size: ${theme.font.code.size.small};
    margin-top: 1rem;
  `}
`;

const InfoText = styled(Text)`
  margin-top: 1rem;
`;

const ButtonsWrapper = styled.div`
  display: flex;
  margin-top: 1rem;

  & > * {
    margin-right: 1rem;
  }
`;

type ReadmeProps = ModalPageProps & {
  /** Markdown text */
  readme: string;
};

const Readme: FC<React.PropsWithChildren<ReadmeProps>> = ({ readme }) => (
  <ModalFrame name="export-workspace" title buttonProps={{ text: "Continue" }}>
    <Markdown>{readme}</Markdown>
  </ModalFrame>
);
