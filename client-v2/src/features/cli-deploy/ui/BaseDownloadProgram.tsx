import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { AsyncButton } from "@/shared/ui/async-button";
import type { DownloadFailure } from "../model/program";

/** A failure the user is told about beside the button rather than in a toast */
export type DownloadNote = Extract<DownloadFailure, "no-build" | "not-built">;

const NOTES: Record<DownloadNote, string> = {
  "no-build": "Build the program to download the binary.",
  "not-built": "Build again to download the binary.",
};

export interface BaseDownloadProgramProps {
  /** The file the binary is saved as, `<program>.so` */
  fileName: string;
  /** Why the last press saved nothing, when a build would fix it */
  note: DownloadNote | null;
  /** Fetches and saves the binary; a rejection is a failure to report */
  onDownload: () => Promise<void>;
}

/** Saves the program binary the last build produced; nothing is kept here */
const BaseDownloadProgram = (p: BaseDownloadProgramProps) => (
  <>
    <AsyncButton
      variant="outline"
      title={`Save ${p.fileName}`}
      onClick={p.onDownload}
      onError={reportButtonFailure("download the program binary")}
    >
      Download .so
    </AsyncButton>
    {p.note && (
      <span role="status" className="font-mono text-xs text-muted-foreground">
        {NOTES[p.note]}
      </span>
    )}
  </>
);

export default BaseDownloadProgram;
