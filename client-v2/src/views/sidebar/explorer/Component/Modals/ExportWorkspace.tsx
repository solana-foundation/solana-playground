import { InfoIcon } from "lucide-react";
import { FC, useEffect, useState } from "react";

import type { ProjectKind } from "@/features/project-export";
import {
  DEFAULT_KEYPAIR_PATH,
  exportAsIs,
  exportConverted,
  exportedEndpoint,
  isDownloadFailure,
  KEYPAIR_VARIABLE,
  readProjectKind,
  RPC_URL_VARIABLE,
} from "@/features/project-export";
import { createLogger } from "@/shared/lib/logger";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { AsyncButton } from "@/shared/ui/async-button";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import type { ModalPageProps } from "@/widgets/overlays";
import {
  ModalFrame,
  modalPage,
  ModalPages,
  useModalId,
} from "@/widgets/overlays";

import { ExportFile } from "../../../../../components/Icons";
import Markdown from "../../../../../components/Markdown";
import { PgExplorer, PgFramework, PgView } from "../../../../../utils";

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
  // Empty with no project named or open, which the export refuses
  const project = name ?? PgExplorer.currentWorkspaceName ?? "";
  const label = project || "the project";
  const id = useModalId();
  // The program copy shows until the project is read, and stays if the read
  // fails: the export reads the project again and reports its own failure
  const [kind, setKind] = useState<ProjectKind>("program");
  useEffect(() => {
    let current = true;
    // Another project's kind must not word this one's dialog
    setKind("program");
    readProjectKind(project).then(
      (read) => current && setKind(read),
      (e) => {
        // Only the copy is lost; the export itself says when it fails
        log.warn("could not read the project to word the dialog", {
          context: { error: String(e) },
        });
      }
    );
    return () => {
      current = false;
    };
  }, [project]);

  const convertAndExport = async () => {
    let readme: string;
    try {
      readme = await exportConverted(project);
    } catch (e) {
      // The zip itself failed: an export as is would fail the same way
      if (isDownloadFailure(e)) {
        reportExportFailure(e);
        return;
      }
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

  /**
   * Nothing downloaded: the user hears it and the team hears why. Not
   * rethrown: the button's `onError` (`reportButtonFailure`) logs
   * unreported, and its toast would say it a second time
   */
  const reportExportFailure = (e: unknown) => {
    log.error(e, { report: true, context: { step: "export" } });
    PgView.setToast(() => <span>Could not export {label}.</span>, {
      options: { name: "export-failed" },
    });
  };

  /** Whether the project downloaded */
  const exportWithoutChanges = async () => {
    try {
      await exportAsIs(project);
    } catch (e) {
      reportExportFailure(e);
      return false;
    }
    PgView.closeModal(null, id);
    return true;
  };

  return (
    <ModalFrame
      name="export-workspace"
      title={`Export ${label}`}
      // No field to land on, so Radix would ring the header's Close on open
      openFocus="dialog"
    >
      <div className="max-w-[26rem]">
        {kind === "no-program" ? (
          <>
            <p className="font-bold">Make it a Node project?</p>

            <p className="mt-4 text-[0.75rem] text-[color:var(--text-secondary)]">
              Playground runs <code>client/</code> and <code>tests/</code> in
              the browser, where it provides <code>pg.connection</code> and{" "}
              <code>pg.wallet</code>.
            </p>

            <p className="mt-4 text-[0.75rem] text-[color:var(--text-secondary)]">
              Converting adds <code>package.json</code>,{" "}
              <code>tsconfig.json</code> and run scripts.{" "}
              <code>pg.connection</code> connects to{" "}
              <code>{RPC_URL_VARIABLE}</code>, or to{" "}
              <code>{exportedEndpoint()}</code>, and <code>pg.wallet</code>{" "}
              reads <code>{KEYPAIR_VARIABLE}</code>, or{" "}
              <code>{DEFAULT_KEYPAIR_PATH}</code>.
            </p>
          </>
        ) : (
          <>
            <p className="font-bold">Convert the project layout?</p>

            <p className="mt-4 text-[0.75rem] text-[color:var(--text-secondary)]">
              Playground uses a different layout than the framework's default
              layout.
            </p>

            <p className="mt-4 text-[0.75rem] text-[color:var(--text-secondary)]">
              To make the project work locally, playground can make the
              necessary conversion before exporting.
            </p>
          </>
        )}

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
