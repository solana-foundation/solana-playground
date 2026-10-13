import { PgCommon } from "./common";

export class PgEditor {
  /** All editor event names */
  static readonly events = {
    FOCUS: "editorfocus",
    FORMAT: "editorformat",
    /** The user tried to type in a read-only editor */
    READ_ONLY_EDIT: "editorreadonlyedit",
  };

  /** Focus the editor. */
  static focus() {
    PgCommon.createAndDispatchCustomEvent(PgEditor.events.FOCUS);
  }
}
