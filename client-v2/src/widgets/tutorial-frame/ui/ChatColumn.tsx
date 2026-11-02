import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { PgCommon } from "@/utils/common";
import {
  CHAT_WIDTH,
  chatDefaultWidth,
  clampChatWidth,
} from "../model/chat-width";
import { readChatWidth, writeChatWidth } from "../model/storage";
import { tutorialFrameTelemetry } from "../model/telemetry";
import BaseChatColumn from "./BaseChatColumn";

/** The window's width, kept live */
const useWindowWidth = () => {
  const [width, setWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
};

export interface ChatColumnProps {
  /** The tutorial's name, in the head */
  name: string;
  /** Back to the Tutorials page */
  onBack: () => void;
  /** Clears the tutorial's progress; absent, "Start over…" shows disabled */
  onStartOver?: () => Promise<void>;
  /** Steps passed so far, for Start over's question */
  passed?: number;
  /** The step bar, the feed and the composer */
  children: ReactNode;
}

/**
 * The chat column, connected: its width follows the window until someone
 * picks one, which this device keeps; a double click hands it back. The
 * window narrowing holds a picked width to what it leaves the workspace.
 */
const ChatColumn = ({
  name,
  onBack,
  onStartOver,
  passed,
  children,
}: ChatColumnProps) => {
  const windowWidth = useWindowWidth();
  const [picked, setPicked] = useState<number | null>(() => readChatWidth());
  // Mid-drag the edge follows the pointer; only the drag's end is kept
  const [dragging, setDragging] = useState<number | null>(null);
  const width = clampChatWidth(
    dragging ?? picked ?? chatDefaultWidth(windowWidth),
    windowWidth
  );
  const max = clampChatWidth(CHAT_WIDTH.max, windowWidth);

  return (
    <BaseChatColumn
      name={name}
      onBack={onBack}
      onStartOver={onStartOver}
      passed={passed}
      mac={PgCommon.getOS() === "MacOS"}
      width={width}
      min={CHAT_WIDTH.min}
      max={max}
      onWidthChange={setDragging}
      onWidthPick={(next, via) => {
        setDragging(null);
        // Kept as picked, within the column's own range: the window holds it
        // only at render, so a window that widens again gives it back
        const kept = Math.min(CHAT_WIDTH.max, Math.max(CHAT_WIDTH.min, next));
        const shown = clampChatWidth(kept, windowWidth);
        // A key at either end, or a drag back to where it began, changes nothing
        if (shown === width && kept === (picked ?? width)) return;
        setPicked(kept);
        writeChatWidth(kept);
        tutorialFrameTelemetry.track("tutorial_frame_chat_resized", {
          width: shown,
          via,
        });
      }}
      onReset={() => {
        setDragging(null);
        setPicked(null);
        writeChatWidth(null);
        tutorialFrameTelemetry.track("tutorial_frame_chat_resized", {
          width: clampChatWidth(chatDefaultWidth(windowWidth), windowWidth),
          via: "reset",
        });
      }}
    >
      {children}
    </BaseChatColumn>
  );
};

export default ChatColumn;
