import { PgCommon } from "./common";

/**
 * Who holds the editor read only: the tutorial's preview of the finished
 * program (and Code on the phone), or an act the tutorial runs
 */
export type ReadOnlyHolder = "preview" | "act";

export class PgEditor {
  /** All editor event names */
  static readonly events = {
    FOCUS: "editorfocus",
    FORMAT: "editorformat",
    REVEAL_LINE: "editorrevealline",
    READ_ONLY: "editorreadonly",
  };

  /**
   * Who holds the editor read only, and how many times each. The editor
   * refuses typing while anyone holds it, so one holder letting go never
   * frees an editor another still holds: a build that started under the
   * phone's lock outlives that lock.
   */
  private static _holds = new Map<ReadOnlyHolder, number>();

  /** Whether the editor refuses typing, whichever file it shows */
  static get readOnly() {
    return PgEditor._holds.size > 0;
  }

  /**
   * Whether `holder` holds the editor read only. The program id is written
   * through an act's lock, as a build needs it, but not into the preview.
   *
   * @param holder who may hold it
   */
  static isReadOnlyFor(holder: ReadOnlyHolder) {
    return PgEditor._holds.has(holder);
  }

  /**
   * Make the editor refuse typing until the hold is disposed. Kept here
   * rather than only sent, so an editor that mounts later starts in the same
   * state. Writes through the explorer still reach the files.
   *
   * @param holder who holds it
   * @returns the hold; disposing it twice lets go once
   */
  static holdReadOnly(holder: ReadOnlyHolder) {
    PgEditor._changeHolds(holder, 1);
    let held = true;
    return {
      dispose: () => {
        if (!held) return;
        held = false;
        PgEditor._changeHolds(holder, -1);
      },
    };
  }

  private static _changeHolds(holder: ReadOnlyHolder, by: 1 | -1) {
    const count = (PgEditor._holds.get(holder) ?? 0) + by;
    if (count > 0) PgEditor._holds.set(holder, count);
    else PgEditor._holds.delete(holder);
    PgCommon.createAndDispatchCustomEvent(
      PgEditor.events.READ_ONLY,
      PgEditor.readOnly
    );
  }

  /** Focus the editor. */
  static focus() {
    PgCommon.createAndDispatchCustomEvent(PgEditor.events.FOCUS);
  }

  /**
   * Scroll the editor so `line` sits a third of the way down, with the caret
   * at its start, if the file open in it is `path`; another file stays where
   * it is. A file being opened reads its saved position instead.
   *
   * @param path full path of the file the line is in
   * @param line 1-based line number
   */
  static revealLine(path: string, line: number) {
    PgCommon.createAndDispatchCustomEvent(PgEditor.events.REVEAL_LINE, {
      path,
      line,
    });
  }
}
