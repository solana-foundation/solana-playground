import { useState } from "react";

import { PgGithub } from "@/utils";

import type { UrlImport } from "./BaseImportFromUrl";
import BaseImportFromUrl from "./BaseImportFromUrl";

// Design prototype for sync log 9.1 (HOO-2608): no import runs. The states
// come from `?import=empty|focus|typed|importing|bad|private|off`, and a
// press fakes the answer from the link alone. Not meant to merge.

const BAD = "This isn't a GitHub repo or gist link.";
const PRIVATE =
  "This repo is private. Make it public or import it from your machine.";

const SAMPLE = "https://github.com/solana-developers/program-examples";

const PRESETS: Record<string, { url: string; status: UrlImport }> = {
  typed: { url: SAMPLE, status: { state: "idle" } },
  importing: { url: SAMPLE, status: { state: "importing" } },
  bad: {
    url: "https://gitlab.com/acme/escrow",
    status: { state: "failed", error: BAD },
  },
  private: {
    url: "https://github.com/acme/escrow-private",
    status: { state: "failed", error: PRIVATE },
  },
};

const getMode = () =>
  new URLSearchParams(window.location.search).get("import") ?? "empty";

const isGistLink = (url: string) =>
  /^https?:\/\/gist\.github\.com\/[\w-]+\/[0-9a-f]+/i.test(url.trim());

const ImportFromUrl = () => {
  const mode = getMode();
  const preset = PRESETS[mode];
  const [url, setUrl] = useState(preset?.url ?? "");
  const [status, setStatus] = useState<UrlImport>(
    preset?.status ?? { state: "idle" }
  );

  // eslint-disable-next-line unicorn/no-null -- React's "draw nothing"
  if (mode === "off") return null;

  const fakeImport = () => {
    const link = url.trim();
    if (!PgGithub.isValidUrl(link) && !isGistLink(link)) {
      setStatus({ state: "failed", error: BAD });
      return;
    }
    if (link.includes("private")) {
      setStatus({ state: "failed", error: PRIVATE });
      return;
    }
    setStatus({ state: "importing" });
  };

  return (
    <BaseImportFromUrl
      url={url}
      onUrl={(next) => {
        setUrl(next);
        setStatus({ state: "idle" });
      }}
      status={status}
      onImport={fakeImport}
      autoFocus={mode === "focus"}
    />
  );
};

export default ImportFromUrl;
