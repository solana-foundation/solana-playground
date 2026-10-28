import { FC, useState } from "react";
import { InfoIcon } from "lucide-react";
import styled, { css } from "styled-components";

import Img from "../../../../../components/Img";
import Input from "../../../../../components/Input";
import Link from "../../../../../components/Link";
import { importGist, isGistUrl } from "@/features/gist";
import { ModalFrame, SubmitCancelled, useModalId } from "@/widgets/overlays";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import { Eye, Github, ImportWorkspace } from "../../../../../components/Icons";
import {
  Framework,
  PgCommon,
  PgFramework,
  ImportCancelledError,
  PgGithub,
  PgRouter,
  PgView,
} from "../../../../../utils";
import { AsyncButton } from "@/shared/ui/async-button";
import { Button } from "@/shared/ui/button";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";

export const ImportGithub = () => {
  // Handle user input
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  return (
    <ModalFrame
      name="import-github"
      title
      buttonProps={{
        text: "Import",
        onSubmit: async () => {
          try {
            await PgCommon.transition(
              isGistUrl(url) ? importGist(url, "dialog") : PgGithub.import(url)
            );
          } catch (e) {
            // Closing the program choice is the user changing their mind,
            // not a failure: the import dialog stays, quietly
            if (e instanceof ImportCancelledError) throw new SubmitCancelled();
            throw e;
          }
        },
        disabled: !!error,
      }}
    >
      <Wrapper>
        <GithubUrlWrapper>
          <GithubUrlInputLabel>GitHub or gist URL</GithubUrlInputLabel>
          <Input
            autoFocus
            value={url}
            onChange={(ev) => setUrl(ev.target.value)}
            validator={isImportableUrl}
            error={error}
            setError={setError}
            placeholder="https://github.com/... or https://gist.github.com/..."
          />
        </GithubUrlWrapper>

        <Description>
          Projects can be imported or viewed from their GitHub URL, or from the
          URL of a gist.
        </Description>

        <ExamplesSectionWrapper>
          <ExamplesTitle>Examples</ExamplesTitle>
          <ExamplesWrapper>
            {PgFramework.all.map((framework) => (
              <Example key={framework.name} framework={framework} />
            ))}
          </ExamplesWrapper>
        </ExamplesSectionWrapper>

        <Callout variant="info">
          <InfoIcon />
          <CalloutDescription className="[&_p+p]:mt-4">
            <p>
              Program repositories can be viewed in playground by combining the
              playground URL with their GitHub URL. For example, from{" "}
              <Link href={GITHUB_PROGRAM_URL}>this repository</Link>:
            </p>

            <p style={{ wordBreak: "break-all" }}>
              <Link href={VIEW_URL}>{VIEW_URL}</Link>
            </p>
          </CalloutDescription>
        </Callout>
      </Wrapper>
    </ModalFrame>
  );
};

/** A repository URL goes to repository import, a gist URL to gist import */
const isImportableUrl = (url: string) =>
  PgGithub.isValidUrl(url) || isGistUrl(url);

const GITHUB_PROGRAM_URL =
  "https://github.com/solana-developers/program-examples/tree/main/basics/create-account/anchor";

const VIEW_URL = PgRouter.getPathUrl(GITHUB_PROGRAM_URL);

const Wrapper = styled.div`
  max-width: 39rem;
`;

const GithubUrlWrapper = styled.div``;

const GithubUrlInputLabel = styled.div`
  margin-bottom: 0.5rem;
  font-weight: bold;
`;

const Description = styled.div`
  ${({ theme }) => css`
    margin: 1rem 0;
    font-size: ${theme.font.code.size.small};
    color: ${theme.colors.default.textSecondary};
    word-break: break-all;
  `}
`;

const ExamplesSectionWrapper = styled.div`
  margin: 1rem 0;
`;

const ExamplesTitle = styled.div`
  font-weight: bold;
`;

const ExamplesWrapper = styled.div`
  margin-top: 0.5rem;
`;

interface ExampleProps {
  framework: Framework;
}

const Example: FC<React.PropsWithChildren<ExampleProps>> = ({ framework }) => {
  const id = useModalId();
  return (
    <ExampleWrapper>
      <FrameworkWrapper>
        <FrameworkImage src={framework.icon} $circle={framework.circleImage} />
        <FrameworkName>
          {framework.name} - {framework.githubExample.name}
        </FrameworkName>
      </FrameworkWrapper>

      <ExampleButtonsWrapper>
        <AsyncButton
          type="button"
          variant="outline"
          onClick={async () => {
            try {
              await PgGithub.import(framework.githubExample.url);
            } catch (e) {
              // Closing the program selection is a choice, not a failure
              if (e instanceof ImportCancelledError) return;
              throw e;
            }
            PgView.closeModal(null, id);
          }}
          onError={reportButtonFailure("import the program")}
        >
          Import
          <ImportWorkspace data-icon="inline-end" />
        </AsyncButton>

        <Button
          type="button"
          variant="outline"
          onClick={() => {
            PgRouter.navigate("/" + framework.githubExample.url);
            PgView.closeModal(null, id);
          }}
        >
          Open
          <Eye data-icon="inline-end" />
        </Button>

        <Button asChild variant="outline">
          <a
            href={framework.githubExample.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open in GitHub
            <Github data-icon="inline-end" />
          </a>
        </Button>
      </ExampleButtonsWrapper>
    </ExampleWrapper>
  );
};

const ExampleWrapper = styled.div`
  margin: 1rem 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const ExampleButtonsWrapper = styled.div`
  display: flex;

  & > * {
    margin-left: 1.5rem;
  }
`;

const FrameworkWrapper = styled.div`
  ${({ theme }) => css`
    padding: 0.5rem 1rem;
    width: fit-content;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: ${theme.default.borderRadius};
  `}
`;

const FrameworkImage = styled(Img)<{ $circle?: boolean }>`
  ${({ $circle }) => css`
    width: 1rem;
    height: 1rem;
    border-radius: ${$circle && "50%"};
  `}
`;

const FrameworkName = styled.span`
  margin-left: 0.5rem;
  font-weight: bold;
  color: ${({ theme }) => theme.colors.default.textSecondary};
`;
