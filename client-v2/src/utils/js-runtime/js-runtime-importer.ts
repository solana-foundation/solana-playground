import { format } from "util";

import { Emoji } from "../../constants";
import { PgTerminal } from "../terminal";

export class PgJsRuntimeImporter {
  /** Whether `console.log` is overridden */
  private static _isOverridden: boolean;
  /** The default `console.log` */
  // eslint-disable-next-line no-console -- keeps the original to call from the wrapper that mirrors mocha output to the terminal
  private static _consoleLog = console.log;

  /**
   * Redefine `console.log` to show `mocha` logs in the terminal and
   * asynchronously import `PgJsRuntime`.
   */
  static async import() {
    if (!this._isOverridden) {
      // Overriding needs to happen before the client is imported
      // eslint-disable-next-line no-console -- mocha prints through console.log; the wrapper mirrors that output to the terminal
      console.log = (msg, ...rest) => {
        this._consoleLog(msg, ...rest);

        if (msg !== undefined) {
          // We only want to print `mocha` logs in the terminal
          const fullMessage = format(msg, ...rest);
          if (fullMessage.startsWith("  ")) {
            const editedMessage = fullMessage
              // Replace checkmark icon
              .replace(
                Emoji.CHECKMARK_BUTTON,
                PgTerminal.success(Emoji.CHECKMARK)
              )
              // Make '1) testname' red
              .replace(/\s+\d\)\s\w*$/, PgTerminal.error)
              // Passing text
              .replace(/\d+\spassing/, PgTerminal.success)
              // Failing text
              .replace(/\d+\sfailing/, PgTerminal.error)
              // Don't show the stack trace because it shows the transpiled code
              // TODO: show where the error actually happened in user code
              .replace(/\s+at.*$/gm, "");

            PgTerminal.println(editedMessage);
          }
        }
      };
      this._isOverridden = true;
    }

    return await import("./js-runtime");
  }
}
