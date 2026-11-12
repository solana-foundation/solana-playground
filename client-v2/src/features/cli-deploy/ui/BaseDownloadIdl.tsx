import { Button } from "@/shared/ui/button";

export interface BaseDownloadIdlProps {
  /** The file the IDL is saved as, `<program>.json` */
  fileName: string;
  /** Playground holds an IDL for the program */
  hasIdl: boolean;
  /** Saves the IDL */
  onDownload: () => void;
  /** The id of the visible line saying why it is off */
  describedBy: string;
}

/**
 * Saves the IDL Playground holds, beside "Download .so". Without one it is
 * `aria-disabled`, not `disabled`, and refuses the press: it stays focusable
 * and points at the visible line saying why, which a native `disabled`
 * button would hide from keyboard and screen-reader users.
 */
const BaseDownloadIdl = (p: BaseDownloadIdlProps) => (
  <Button
    variant="outline"
    aria-disabled={!p.hasIdl}
    aria-describedby={p.hasIdl ? undefined : p.describedBy}
    className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
    title={p.hasIdl ? `Save ${p.fileName}` : "This program has no IDL"}
    onClick={p.hasIdl ? p.onDownload : undefined}
  >
    Download IDL
  </Button>
);

export default BaseDownloadIdl;
