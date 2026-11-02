import { useEffect, useReducer, useRef, useState } from "react";
import type { ReactNode } from "react";

import { useRenderOnChange } from "@/hooks";
import { PgExplorer } from "@/utils/explorer";
import { PgTutorial } from "@/utils/tutorial";
import { NAV_FOLD_ON_ENTRY, foldNav } from "../model/nav-fold";
import type { NavFold } from "../model/nav-fold";
import { tutorialFrameTelemetry } from "../model/telemetry";
import type { MenuSource } from "../model/telemetry";
import BaseNavPin from "./BaseNavPin";
import ChatColumn from "./ChatColumn";
import NavHint from "./NavHint";

export interface UseTutorialFrameOptions {
  /** Back to the Tutorials page */
  onBack: () => void;
  /** Clears the tutorial's progress; absent, "Start over…" shows disabled */
  onStartOver?: () => Promise<void>;
  /** Steps passed so far, for Start over's question */
  passed?: number;
  /** What the chat column holds under its head: the step bar, feed, composer */
  body: ReactNode;
}

/**
 * The frame's parts, structurally the layout shell's `TutorialFrameSlot`
 * (one widget does not import another; the view composes them)
 */
export interface TutorialFrame {
  chat: ReactNode;
  nav: {
    fold: NavFold;
    onOpenChange: (open: boolean) => void;
    onClose: () => void;
  };
  overNav?: ReactNode;
}

export interface UseTutorialFrame {
  /** Given while a tutorial with a definition is open, for the shell */
  frame?: TutorialFrame;
  /** The pin for the navigation's open head, while it is open in the frame */
  pin?: ReactNode;
}

/**
 * The open tutorial, from the route, while it has a definition and has been
 * started. Before Start its About page keeps today's layout: the feed's
 * intro card (`tutorial-flow-v2` 3.3) is what replaces it.
 */
const useDefinitionTutorial = () => {
  useRenderOnChange(PgTutorial.onDidChangeCurrent);
  // Start creates the workspace well after the route has changed, and on a
  // cold load the explorer initialises after the first render
  useRenderOnChange(PgTutorial.onDidChange);
  useRenderOnChange(PgExplorer.onDidInit);
  const current = PgTutorial.current;
  if (!current?.definition) return null;
  // `isStarted` throws until the explorer knows its workspaces
  if (!PgExplorer.allWorkspaceNames) return null;
  return PgTutorial.isStarted(current.name) ? current : null;
};

/**
 * The tutorial frame for the open route: the chat column, the navigation's
 * fold rules, the pin and the first fold's hint. Entering a tutorial folds
 * the navigation, whatever the saved layout holds; leaving drops the frame,
 * and the saved layout is back, since none of this was written to it.
 */
export const useTutorialFrame = ({
  onBack,
  onStartOver,
  passed,
  body,
}: UseTutorialFrameOptions): UseTutorialFrame => {
  const tutorial = useDefinitionTutorial();
  const [fold, dispatch] = useReducer(foldNav, NAV_FOLD_ON_ENTRY);

  // Each tutorial entered starts folded, from its first render: reset in an
  // effect, the previous visit's pinned navigation drew for one frame
  const name = tutorial?.name ?? null;
  const [entered, setEntered] = useState<string | null>(null);
  if (name !== entered) {
    setEntered(name);
    if (name) dispatch({ type: "enter" });
  }

  // The stock toggle reports only the state it asks for, so the last input
  // says whether ⌘B or a button opened it
  const lastInput = useRef<MenuSource>("button");
  useEffect(() => {
    // Only ⌘B (Ctrl+B) is the key: Enter on the rail's button is a button
    const onKey = (e: KeyboardEvent) => {
      const toggle = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b";
      lastInput.current = toggle ? "key" : "button";
    };
    const onPointer = () => (lastInput.current = "button");
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, []);

  if (!tutorial) return {};

  const onPinnedChange = (pinned: boolean) => {
    dispatch({ type: pinned ? "pin" : "unpin" });
    tutorialFrameTelemetry.track("tutorial_frame_menu_pinned", { pinned });
  };

  return {
    frame: {
      chat: (
        <ChatColumn
          name={tutorial.name}
          onBack={onBack}
          onStartOver={onStartOver}
          passed={passed}
        >
          {body}
        </ChatColumn>
      ),
      nav: {
        fold,
        onOpenChange: (open) => {
          if (open && fold === "rail") {
            tutorialFrameTelemetry.track("tutorial_frame_menu_opened", {
              via: lastInput.current,
            });
          }
          dispatch({ type: open ? "open" : "fold" });
        },
        onClose: () => dispatch({ type: "close" }),
      },
      overNav: <NavHint folded={fold === "rail"} />,
    },
    pin:
      fold === "rail" ? undefined : (
        <BaseNavPin
          pinned={fold === "pinned"}
          onPinnedChange={onPinnedChange}
        />
      ),
  };
};
