import { InfoIcon } from "lucide-react";
import { FC, useState } from "react";

import { importGist, isGistUrl } from "@/features/gist";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { cn } from "@/shared/lib/utils";
import { AsyncButton } from "@/shared/ui/async-button";
import { Button } from "@/shared/ui/button";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import { FieldError } from "@/shared/ui/field";
import { Icon } from "@/shared/ui/icon";
import { ModalFrame, SubmitCancelled, useModalId } from "@/widgets/overlays";

import { Github } from "../../../../../components/Icons";
import Img from "../../../../../components/Img";
import Input from "../../../../../components/Input";
import Link from "../../../../../components/Link";
import {
  Framework,
  ImportCancelledError,
  PgCommon,
  PgFramework,
  PgGithub,
  PgRouter,
  PgView,
} from "../../../../../utils";
import { IMPORTED } from "./imported";
import { useLimitRefusal } from "./useLimitRefusal";

export const ImportGithub = () => {
  // Handle user input
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const { limitError, guard } = useLimitRefusal();

  return (
    <ModalFrame
      name="import-github"
      title
      buttonProps={{
        text: "Import",
        onSubmit: guard(async () => {
          try {
            await PgCommon.transition(
              isGistUrl(url) ? importGist(url, "dialog") : PgGithub.import(url)
            );
            return IMPORTED;
          } catch (e) {
            // Closing the program choice is the user changing their mind,
            // not a failure: the import dialog stays, quietly
            if (e instanceof ImportCancelledError) throw new SubmitCancelled();
            throw e;
          }
        }),
        disabled: !!error,
      }}
    >
      <div className="max-w-[39rem]">
        <FieldError data-testid="explorer-limit-error" className="mb-2">
          {limitError}
        </FieldError>
        <div>
          <div className="mb-2 font-bold">GitHub or gist URL</div>
          <Input
            autoFocus
            value={url}
            onChange={(ev) => setUrl(ev.target.value)}
            validator={isImportableUrl}
            error={error}
            setError={setError}
            placeholder="https://github.com/... or https://gist.github.com/..."
          />
        </div>

        <div className="my-4 text-[0.75rem] break-all text-[color:var(--text-secondary)]">
          Projects can be imported or viewed from their GitHub URL, or from the
          URL of a gist.
        </div>

        <div className="my-4">
          <div className="font-bold">Examples</div>
          <div className="mt-2">
            {PgFramework.all.map(
              (framework) =>
                framework.githubExample && (
                  <Example
                    key={framework.name}
                    name={framework.name}
                    icon={framework.icon}
                    circleImage={framework.circleImage}
                    example={framework.githubExample}
                  />
                )
            )}
          </div>
        </div>

        <Callout variant="info">
          <InfoIcon />
          <CalloutDescription className="[&_p+p]:mt-4">
            <p>
              Program repositories can be viewed in playground at /github/
              followed by their GitHub path. For example, from{" "}
              {/* The callout underlines its links; the link's own hover
                  line would draw a second one under it */}
              <Link
                href={GITHUB_PROGRAM_URL}
                className="hover:border-transparent"
              >
                this repository
              </Link>
              :
            </p>

            <p style={{ wordBreak: "break-all" }}>
              <Link href={VIEW_URL} className="hover:border-transparent">
                {VIEW_URL}
              </Link>
            </p>
          </CalloutDescription>
        </Callout>
      </div>
    </ModalFrame>
  );
};

/** A repository URL goes to repository import, a gist URL to gist import */
const isImportableUrl = (url: string) =>
  PgGithub.isValidUrl(url) || isGistUrl(url);

const GITHUB_PROGRAM_URL =
  "https://github.com/solana-foundation/program-examples/tree/main/basics/create-account/anchor";

/** The explainer's example: where the app opens that repository */
const VIEW_URL = PgRouter.getPathUrl(PgGithub.routePath(GITHUB_PROGRAM_URL));

interface ExampleProps {
  /** The framework's name, icon and image shape */
  name: Framework["name"];
  icon: Framework["icon"];
  circleImage: Framework["circleImage"];
  /** The framework's example, so the row never reads an absent one */
  example: NonNullable<Framework["githubExample"]>;
}

const Example: FC<ExampleProps> = ({ name, icon, circleImage, example }) => {
  const id = useModalId();
  const title = `${name} – ${example.name}`;
  return (
    // The name on its own line and the buttons under it: beside the buttons a
    // name has no room, and rows of different lengths wrap unevenly
    <div data-testid="github-example" className="my-3 flex flex-col gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <Img
          src={icon}
          className={cn("size-4 shrink-0", circleImage && "rounded-[50%]")}
        />
        <span
          title={title}
          className="truncate font-bold text-[color:var(--text-secondary)]"
        >
          {title}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <AsyncButton
          type="button"
          size="sm"
          variant="outline"
          onClick={async () => {
            try {
              await PgGithub.import(example.url);
            } catch (e) {
              // Closing the program selection is a choice, not a failure
              if (e instanceof ImportCancelledError) return;
              throw e;
            }
            PgView.closeModal(IMPORTED, id);
          }}
          onError={reportButtonFailure("import the program")}
        >
          Import
          <Icon name="import" data-icon="inline-end" />
        </AsyncButton>

        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            PgRouter.navigate(PgGithub.routePath(example.url));
            PgView.closeModal(IMPORTED, id);
          }}
        >
          Open
          <Icon name="show" data-icon="inline-end" />
        </Button>

        <Button asChild size="sm" variant="outline">
          <a href={example.url} target="_blank" rel="noopener noreferrer">
            Open in GitHub
            <Github data-icon="inline-end" />
          </a>
        </Button>
      </div>
    </div>
  );
};
