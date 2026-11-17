import { useId } from "react";

import { Button } from "@/shared/ui/button";
import { FieldError } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { Spinner } from "@/shared/ui/spinner";

/** Where an import stands. `importing` locks the field and the button */
export type UrlImport =
  | { state: "idle" }
  | { state: "importing" }
  | { state: "failed"; error: string };

export interface BaseImportFromUrlProps {
  url: string;
  onUrl: (url: string) => void;
  status: UrlImport;
  onImport: () => void;
  /** Something else on the page runs: Import waits, the field stays */
  held?: boolean;
  autoFocus?: boolean;
}

/**
 * Import from a link, as a row of its own under Start from scratch: a GitHub
 * repo or gist link and Import, with what went wrong under the field. Import
 * is the outline button, so Start stays the one accent on the page.
 */
const BaseImportFromUrl = ({
  url,
  onUrl,
  status,
  onImport,
  held = false,
  autoFocus,
}: BaseImportFromUrlProps) => {
  const isImporting = status.state === "importing";
  const error = status.state === "failed" ? status.error : undefined;
  const canImport = !isImporting && !held && url.trim() !== "";
  const errorId = useId();
  const urlId = useId();

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface-panel p-4 md:p-5">
      <label
        htmlFor={urlId}
        className="min-w-0 text-control font-act text-foreground max-md:text-body"
      >
        Import from GitHub
      </label>

      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="flex gap-2 max-md:flex-col">
          <Input
            id={urlId}
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            autoFocus={autoFocus}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="min-w-0 md:flex-1 max-md:h-12 max-md:px-3.5 max-md:text-body"
            value={url}
            placeholder="Paste a GitHub repo or gist link"
            disabled={isImporting}
            onChange={(e) => onUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canImport) onImport();
            }}
          />
          <Button
            type="button"
            variant="outline"
            className="h-8 px-3.5 max-md:h-12 max-md:text-control"
            disabled={!canImport}
            aria-busy={isImporting || undefined}
            onClick={onImport}
          >
            {isImporting ? (
              <>
                <Spinner aria-hidden="true" role={undefined} />
                Importing…
              </>
            ) : (
              "Import"
            )}
          </Button>
        </div>
        <FieldError id={errorId}>{error}</FieldError>
      </div>
    </div>
  );
};

export default BaseImportFromUrl;
