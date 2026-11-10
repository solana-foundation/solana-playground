import { useEffect, useState } from "react";

import { PgCommon } from "@/utils/common";
import { PgExplorer } from "@/utils/explorer";
import { PgView } from "@/utils/view";
import { useCreateItem } from "@/views/sidebar/explorer/Component/useCreateItem";

import BaseNoFileOpen from "./BaseNoFileOpen";
import BaseNoFiles from "./BaseNoFiles";

const hasFiles = () => PgExplorer.getAllFiles().length > 0;

/**
 * The editor with no tab open: `BaseNoFileOpen` while the project has files,
 * asking the shell for Files through `PgView.showFiles`; `BaseNoFiles` once
 * it has none. Add a file runs the Files column's own New file flow
 * (`useCreateItem`) once the column is drawn. Start a project is the
 * caller's (`onStartProject`): New project is another widget's page.
 */
const NoFileOpen = ({ onStartProject }: { onStartProject: () => void }) => {
  const [hasAnyFile, setHasAnyFile] = useState(hasFiles);
  const { createItem } = useCreateItem();

  useEffect(() => {
    const { dispose } = PgExplorer.onNeedRender(() =>
      setHasAnyFile(hasFiles())
    );
    return dispose;
  }, []);

  if (hasAnyFile) return <BaseNoFileOpen onShowFiles={PgView.showFiles} />;
  return (
    <BaseNoFiles
      onAddFile={async () => {
        PgView.showFiles();
        // A folded column or a phone's Files page mounts on the request;
        // the tree is drawn a moment after
        await PgCommon.sleep(100);
        await createItem();
      }}
      onStartProject={onStartProject}
    />
  );
};

export default NoFileOpen;
