import { TerminalLineError } from "../../utils/terminal/line-error";

/**
 * A deploy that did not start because the status says the network is down.
 * Nothing was sent, so it is not a failed deploy: the stage keeps what it had,
 * and the assistant does not report a deployment that failed.
 */
export class NetworkRefusedError extends TerminalLineError {
  name = "NetworkRefusedError";
}
