import { createTracker } from "@/shared/lib/telemetry";

/** What opened the navigation over the chat: ⌘B, or the rail's own button */
export type MenuSource = "key" | "button";

/** What set the chat's width: a drag of its edge, an arrow key, or a double click */
export type ResizeSource = "drag" | "key" | "reset";

/** The phone's two spaces: the conversation, and the code with its docs */
export type TutorialSpace = "chat" | "code";

/**
 * What switched the phone's space: the header's toggle, a sideways swipe, a
 * "Show in <file>" press, a doc link, or a step picked in the steps sheet
 */
export type SpaceSource = "toggle" | "swipe" | "show" | "doc" | "step";

type TutorialFrameEvents = {
  /**
   * The navigation opened as an overlay over the chat in a tutorial; `via`
   * says whether ⌘B or the rail's button did it. Not sent when it closes.
   */
  tutorial_frame_menu_opened: { via: MenuSource };
  /**
   * The pin in the overlay's head docked the navigation open (`pinned`
   * true) or folded it back to the rail (false).
   */
  tutorial_frame_menu_pinned: { pinned: boolean };
  /**
   * The learner set the chat column's width: a drag ended, an arrow key moved
   * the edge, or a double click handed it back to the window (`reset`).
   * `width` is the width it now has, in px.
   */
  tutorial_frame_chat_resized: { width: number; via: ResizeSource };
  /**
   * The phone layout moved between Chat and Code; `via` says what moved it.
   * Not sent when a new tutorial starts back on Chat.
   */
  tutorial_frame_space_changed: { space: TutorialSpace; via: SpaceSource };
};

export const tutorialFrameTelemetry = createTracker<TutorialFrameEvents>();
