import { useCallback, useEffect, useRef, useState } from "react";

import { onCodeRequest, onDocShown } from "@/entities/tutorial";

import type { SpaceSource, TutorialSpace } from "../model/telemetry";
import { tutorialFrameTelemetry } from "../model/telemetry";

export interface UseTutorialSpaceOptions {
  /** The open tutorial's name; a new one starts on Chat */
  name: string | undefined;
  /** How many times the assistant has written code so far (`wrote` turns) */
  wrote: number;
  /** The tutorial is done: Code's dot no longer shows */
  finished: boolean;
  /**
   * The conversation has loaded. Until then `wrote` is 0, so the count a
   * reload restores is taken as seen, not as new writes
   */
  loaded: boolean;
  /** Below the frame's width (the phone layout's viewport); off it, nothing listens for requests */
  phone: boolean;
}

export interface UseTutorialSpace {
  space: TutorialSpace;
  setSpace: (space: TutorialSpace, via: SpaceSource) => void;
  /** The assistant wrote since Code was last in view */
  dot: boolean;
}

/**
 * Which of the phone's two spaces is in view, and Code's dot. A request for
 * the code ("Show in lib.rs"), or a doc page the workspace showed, switches
 * to Code. Each tutorial entered starts on Chat, so a learner never
 * lands on an empty editor before Start.
 */
export const useTutorialSpace = ({
  name,
  wrote,
  finished,
  loaded,
  phone,
}: UseTutorialSpaceOptions): UseTutorialSpace => {
  const [space, setSpaceState] = useState<TutorialSpace>("chat");
  // The `wrote` count last seen in Code (or on entering the tutorial)
  const [seen, setSeen] = useState(wrote);
  const [entered, setEntered] = useState(name);
  const [ready, setReady] = useState(loaded);

  // Adjusted during render, React's pattern for state derived from props
  if (entered !== name) {
    setEntered(name);
    setSpaceState("chat");
    setSeen(wrote);
  } else if (ready !== loaded) {
    setReady(loaded);
    setSeen(wrote);
  } else if ((space === "code" && seen !== wrote) || wrote < seen) {
    setSeen(wrote);
  }

  // What is in view now, for a request that arrives between renders
  const shown = useRef(space);
  shown.current = space;

  const setSpace = useCallback((next: TutorialSpace, via: SpaceSource) => {
    if (shown.current === next) return;
    shown.current = next;
    tutorialFrameTelemetry.track("tutorial_frame_space_changed", {
      space: next,
      via,
    });
    setSpaceState(next);
  }, []);

  useEffect(() => {
    if (!phone) return;
    const stopCode = onCodeRequest(() => setSpace("code", "show"));
    // Only once the workspace showed the page: a link to a page it lacks
    // opens as a link and leaves the chat in view
    const stopDoc = onDocShown(() => setSpace("code", "doc"));
    return () => {
      stopCode();
      stopDoc();
    };
  }, [phone, setSpace]);

  return {
    space,
    setSpace,
    dot: !finished && space === "chat" && wrote > seen,
  };
};
