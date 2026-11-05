import { Editor } from "../Editor";
import { Tabs } from "../Tabs";

const EditorWithTabs = () => (
  <div className="flex h-full w-full flex-col">
    <Tabs />
    <Editor />
  </div>
);

export default EditorWithTabs;
