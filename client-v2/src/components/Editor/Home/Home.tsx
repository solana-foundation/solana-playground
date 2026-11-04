import { useEffect, useState } from "react";

import { PgFramework, PgView } from "../../../utils";
import { BaseEditorHome } from "./BaseEditorHome";
import { ResourceProps, RESOURCES } from "./resources";
import { TUTORIALS } from "./tutorials";

/** The editor with no file open, with what `BaseEditorHome` draws */
const Home = () => {
  // This prevents unnecessarily fetching the home content for a frame when the
  // app is first mounted
  const [resources, setResources] = useState<ResourceProps[]>();
  useEffect(() => {
    setResources(
      PgFramework.all
        .filter((f) => f.docs)
        .map((f) => ({ ...f, ...f.docs } as ResourceProps))
        .concat(RESOURCES)
    );
  }, []);

  if (!resources) return null;

  return (
    <BaseEditorHome
      id={PgView.ids.HOME}
      resources={resources}
      tutorials={TUTORIALS}
    />
  );
};

export default Home;
