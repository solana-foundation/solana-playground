import { useEffect, useState } from "react";

import { PgExplorer } from "@/utils/explorer";
import { PgView } from "@/utils/view";

import { requestNewFile } from "../model/new-file-request";
import BaseNoFileOpen from "./BaseNoFileOpen";
import BaseNoFiles from "./BaseNoFiles";

const hasFiles = () => PgExplorer.getAllFiles().length > 0;

/**
 * The editor with no tab open: `BaseNoFileOpen` while the project has files,
 * asking the shell for Files through `PgView.showFiles`; `BaseNoFiles` once
 * it has none. Add a file asks the Files tree for a new file
 * (`requestNewFile`), which it starts once drawn. Start a project is the
 * caller's (`onStartProject`): New project is another widget's page.
 */
const NoFileOpen = ({ onStartProject }: { onStartProject: () => void }) => {
  const [hasAnyFile, setHasAnyFile] = useState(hasFiles);

  useEffect(() => {
    const { dispose } = PgExplorer.onNeedRender(() =>
      setHasAnyFile(hasFiles())
    );
    return dispose;
  }, []);

  if (hasAnyFile) return <BaseNoFileOpen onShowFiles={PgView.showFiles} />;
  return (
    <BaseNoFiles
      // The tree starts the file once drawn, and reports its own failure
      // ("Could not start a new file."): the button has nothing to wait for
      onAddFile={async () => requestNewFile()}
      onStartProject={onStartProject}
    />
  );
};

export default NoFileOpen;
