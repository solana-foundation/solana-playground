import Grounding from "@/views/sidebar/assistant/Component/Grounding";
import { useMcpSources } from "@/views/sidebar/assistant/model/use-mcp-sources";

/**
 * The skills and MCP servers of the assistant's Sources and tools, on the
 * settings page. Both read and write the one `PgAssistant` store, so a switch
 * here shows in the panel and in the next turn.
 *
 * TODO(HOO-2257): the panel's controls as they are, until the reworked
 * management UI replaces them after Breakpoint.
 */
const AssistantSources = () => {
  // The panel asks on its own mount; the page may open without it (a phone,
  // a closed assistant)
  useMcpSources();
  return <Grounding embedded />;
};

export default AssistantSources;
