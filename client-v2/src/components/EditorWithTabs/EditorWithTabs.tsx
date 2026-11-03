import { createContext, useContext } from "react";
import styled from "styled-components";

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
    <Wrapper>
      {tabs && <Tabs />}
      <Editor />
    </Wrapper>
  );
};

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
`;

export default EditorWithTabs;
