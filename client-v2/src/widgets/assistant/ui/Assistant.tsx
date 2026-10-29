import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";

import { useTutorialBeforeStart } from "@/entities/tutorial";
import { Button } from "@/shared/ui/button";
import Grounding from "../../../views/sidebar/assistant/Component/Grounding";
import { PROVIDERS } from "../../../views/sidebar/assistant/model/types";
import { PgAssistant } from "../../../views/sidebar/assistant/store";
import { PgExplorer } from "../../../utils/explorer/explorer";
import { useTurn } from "../model/use-turn";
import type { ConnectOpener } from "../model/use-turn";
import { AssistantComposer } from "./AssistantComposer";
import { Thread } from "./Thread";
import { BaseAssistantHead } from "./BaseAssistantHead";
import type { ForgetKey } from "./BaseAssistantHead";

/** What the panel shows under its head */
type View = "chat" | "sources";

/** Whether More offers Forget key, and whether it can be pressed now */
const forgetKeyOf = (busy: boolean): ForgetKey => {
  const id = PgAssistant.connection?.id;
  const holdsKey = !!PROVIDERS.find((p) => p.id === id)?.needsKey;
  if (!holdsKey) return "none";
  // The turn is using the key
  if (busy) return "busy";
  return "ready";
};

/** What a heading shows while no project is open yet */
const NO_PROJECT = "Assistant";

/**
 * The open project's name, or `null` before one is open, kept live through a
 * switch or a rename
 */
const useProjectName = () => {
  const read = () => PgExplorer.currentWorkspaceName ?? null;
  const [name, setName] = useState(read);
  useEffect(() => {
    const update = () => setName(read());
    // A rename switches to the new name, and also says so on its own; the
    // explorer initialises after the panel on a cold start
    const subs = [
      PgExplorer.onDidInit(update),
      PgExplorer.onDidSwitchWorkspace(update),
      PgExplorer.onDidRenameWorkspace(update),
    ];
    update();
    return () => subs.forEach((sub) => sub.dispose());
  }, []);
  return name;
};

/**
 * Widen, as the layout shell hands it (its `AssistantWide`): whether the
 * panel is widened to its maximum, and whether it can be now, which it
 * cannot in the Sheet or folded
 */
export interface AssistantWiden {
  wide: boolean;
  setWide(wide: boolean): void;
  canWiden: boolean;
}

export interface AssistantProps {
  widen: AssistantWiden;
  /** Folds the panel, or closes the Sheet */
  onHide(): void;
  /**
   * Opens Connect a model. The dialog's frame belongs to `widgets/overlays`,
   * which a widget may not import, so the app hands the opener in.
   */
  openConnect: ConnectOpener;
}

/**
 * The assistant, connected: its head, then the conversation over the composer,
 * or Sources and tools in their place.
 */
export function Assistant({ widen, onHide, openConnect }: AssistantProps) {
  const { wide, setWide, canWiden } = widen;
  const [view, setView] = useState<View>("chat");
  // Here, above both views, so a turn and a prompt waiting in the composer
  // outlive a visit to Sources; the thread and the composer share this one
  const turn = useTurn({ open: openConnect });
  // With no project open, a tutorial before its Start names the panel. An
  // open project keeps its name: the thread and the tools still act on it.
  const tutorial = useTutorialBeforeStart();
  const project = useProjectName() ?? tutorial;

  // What a pick from More opened takes focus once the menu has closed
  // (`BaseAssistantHead`'s `focusPicked`): Back in Sources; Connect a model
  // is a dialog, which takes it as it opens. Focus the user already put
  // somewhere in the meantime, such as on a select they clicked, is left
  // where it is.
  const sourcesPicked = useRef(false);
  const back = useRef<HTMLButtonElement>(null);
  const focusPicked = () => {
    const toSources = sourcesPicked.current;
    sourcesPicked.current = false;
    const active = document.activeElement;
    if (active && active !== document.body) return true;
    if (!toSources || !back.current) return false;
    back.current.focus();
    return true;
  };

  // Ask the gateway what it serves and what those servers offer. Has to happen
  // here rather than only in Sources: `createTools` reads the result, so a
  // model connected before this ran would be offered no MCP tool at all, with
  // nothing on screen to say why.
  useEffect(() => {
    PgAssistant.initMcp();
  }, []);

  // A prompt raised while Sources is open (a tool call there, say) lands in
  // the composer, which is no use while Sources still covers it
  useEffect(() => {
    return PgAssistant.onDidRequestPrompt(() => setView("chat")).dispose;
  }, []);

  return (
    <div className="flex h-full max-h-full min-h-0 flex-1 flex-col">
      <BaseAssistantHead
        title={project ?? NO_PROJECT}
        onSources={() => {
          setView("sources");
          sourcesPicked.current = true;
        }}
        onConnect={() => turn.openConnect("menu")}
        focusPicked={focusPicked}
        wide={wide}
        onWiden={() => setWide(!wide)}
        onHide={onHide}
        canWiden={canWiden}
        // Read on every render `useTurn` makes for a change in the store
        forgetKey={forgetKeyOf(turn.busy)}
        onForgetKey={() => PgAssistant.disconnect()}
      />
      {view === "chat" && (
        <>
          <Thread turn={turn} project={project} />
          <AssistantComposer turn={turn} />
        </>
      )}
      {view === "sources" && (
        <>
          <div className="shrink-0 px-2 pt-2">
            <Button
              ref={back}
              variant="ghost"
              size="sm"
              onClick={() => setView("chat")}
            >
              <ArrowLeft aria-hidden="true" />
              Back
            </Button>
          </div>
          <Grounding />
        </>
      )}
    </div>
  );
}
