import { FC, useState } from "react";
import { InfoIcon } from "lucide-react";

import { cn } from "@/shared/lib/utils";
import Img from "../../../../../components/Img";
import Input from "../../../../../components/Input";
import Link from "../../../../../components/Link";
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
            await PgCommon.transition(PgGithub.import(url));
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
      <div className="max-w-[39rem]">
        <div>
          <div className="mb-2 font-bold">GitHub URL</div>
          <Input
            autoFocus
            value={url}
            onChange={(ev) => setUrl(ev.target.value)}
            validator={PgGithub.isValidUrl}
            error={error}
            setError={setError}
            placeholder="https://github.com/..."
          />
        </div>

        <div className="my-4 text-[0.75rem] break-all text-[color:var(--text-secondary)]">
          Projects can be imported or viewed from their GitHub URL.
        </div>

        <div className="my-4">
          <div className="font-bold">Examples</div>
          <div className="mt-2">
            {PgFramework.all.map((framework) => (
              <Example key={framework.name} framework={framework} />
            ))}
          </div>
        </div>

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
      </div>
    </ModalFrame>
  );
};

const GITHUB_PROGRAM_URL =
  "https://github.com/solana-developers/program-examples/tree/main/basics/create-account/anchor";

const VIEW_URL = PgRouter.getPathUrl(GITHUB_PROGRAM_URL);

interface ExampleProps {
  framework: Framework;
}

const Example: FC<React.PropsWithChildren<ExampleProps>> = ({ framework }) => {
  const id = useModalId();
  return (
    <div className="my-4 flex items-center justify-between">
      <div className="flex w-fit items-center justify-center rounded-[12px] px-4 py-2">
        <Img
          src={framework.icon}
          className={cn("size-4", framework.circleImage && "rounded-[50%]")}
        />
        <span className="ml-2 font-bold text-[color:var(--text-secondary)]">
          {framework.name} - {framework.githubExample.name}
        </span>
      </div>

      <div className="flex [&>*]:ml-6">
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
      </div>
    </div>
  );
};
