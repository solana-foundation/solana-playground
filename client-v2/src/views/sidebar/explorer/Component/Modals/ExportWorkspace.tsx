import { FC } from "react";
import { InfoIcon } from "lucide-react";

import Markdown from "../../../../../components/Markdown";
import {
  ModalFrame,
  ModalPages,
  modalPage,
  useModalId,
} from "@/widgets/overlays";
import type { ModalPageProps } from "@/widgets/overlays";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import { ExportFile } from "../../../../../components/Icons";
import { PgExplorer, PgFramework, PgView } from "../../../../../utils";
import { createLogger } from "@/shared/lib/logger";
import { AsyncButton } from "@/shared/ui/async-button";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";

const log = createLogger("explorer:export-workspace");

interface ExportWorkspaceProps {
  /** Which workspace to export; defaults to the one the user is in */
  name?: string;
}

export const ExportWorkspace = ({ name }: ExportWorkspaceProps) => (
  <ModalPages
    name="export-workspace"
    defaultPage={modalPage(Default, { name })}
  />
);

type DefaultProps = ModalPageProps & ExportWorkspaceProps;

const Default: FC<React.PropsWithChildren<DefaultProps>> = ({
  setPage,
  name,
}) => {
  const label = name ?? PgExplorer.currentWorkspaceName ?? "the project";
  const id = useModalId();

  const convertAndExport = async () => {
    let readme: string;
    try {
      ({ readme } = await PgFramework.exportWorkspace({
        convert: true,
        name,
      }));
    } catch (e) {
      // A project of no known framework is an expected outcome, noted; any
      // other conversion failure is the team's to hear of
      if (PgFramework.isUnknownFramework(e)) {
        log.warn("no framework to convert to; exporting as is");
      } else {
        log.error(e, { report: true, context: { step: "convert" } });
      }
      // Said only once the plain export has happened: when it fails too,
      // `exportWithoutChanges` says so instead
      if (await exportWithoutChanges()) {
        PgView.setToast(
          () => <span>Could not convert the layout; exported it as is.</span>,
          { options: { name: "export-convert-failed" } }
        );
      }
      return;
    }
    // Outside the `try`: a failure to show the README must not export twice
    setPage(modalPage(Readme, { readme }));
  };

  /** Whether the project downloaded */
  const exportWithoutChanges = async () => {
    try {
      await PgFramework.exportWorkspace({ name });
    } catch (e) {
      // Nothing downloaded: the user hears it and the team hears why. Not
      // rethrown: the button's `onError` (`reportButtonFailure`) logs
      // unreported, and its toast would say it a second time
      log.error(e, { report: true, context: { step: "export" } });
      PgView.setToast(() => <span>Could not export {label}.</span>, {
        options: { name: "export-failed" },
      });
      return false;
    }
    PgView.closeModal(null, id);
    return true;
  };

  return (
    <ModalFrame name="export-workspace" title={`Export ${label}`}>
      <div className="max-w-[26rem]">
        <p className="font-bold">Convert the project layout?</p>

        <p className="mt-4 text-[0.75rem] text-[color:var(--text-secondary)]">
          Playground uses a different layout than the framework's default
          layout.
        </p>

        <p className="mt-4 text-[0.75rem] text-[color:var(--text-secondary)]">
          To make the project work locally, playground can make the necessary
          conversion before exporting.
        </p>

        <Callout variant="info" className="mt-4">
          <InfoIcon />
          <CalloutDescription>
            Conversion may involve modifying JS/TS code to make the code work in
            local Node environment.
          </CalloutDescription>
        </Callout>

        <div className="mt-4 flex [&>*]:mr-4">
          <AsyncButton
            type="button"
            onClick={convertAndExport}
            onError={reportButtonFailure("export the project")}
          >
            Convert and export
            <ExportFile data-icon="inline-end" />
          </AsyncButton>
          <AsyncButton
            type="button"
            variant="outline"
            onClick={exportWithoutChanges}
            onError={reportButtonFailure("export the project")}
          >
            Export without changes
            <ExportFile data-icon="inline-end" />
          </AsyncButton>
        </div>
      </div>
    </ModalFrame>
  );
};

type ReadmeProps = ModalPageProps & {
  /** Markdown text */
  readme: string;
};

const Readme: FC<React.PropsWithChildren<ReadmeProps>> = ({ readme }) => (
  <ModalFrame name="export-workspace" title buttonProps={{ text: "Continue" }}>
    <Markdown>{readme}</Markdown>
  </ModalFrame>
);
