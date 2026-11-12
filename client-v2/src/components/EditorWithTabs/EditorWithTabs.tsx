import { createContext, useContext } from "react";

import { Editor } from "../Editor";
import { Tabs } from "../Tabs";

/**
 * Whether the editor draws its own tab row. A tutorial's workspace
 * (`widgets/tutorial-workspace`) has a head of its own and turns it off, so
 * the code does not sit under two rows of tabs.
 */
export const EditorTabsShown = createContext(true);

const EditorWithTabs = () => {
  const tabs = useContext(EditorTabsShown);
  return (
    <div className="flex h-full w-full flex-col">
      {tabs && <Tabs />}
      <Editor />
    </div>
  );
};

export default EditorWithTabs;
