import { STOPPED } from "../../utils/stopped";

/** What a deploy that ended early (stopped, cancelled or failed) left of its buffer account */
export type StoppedBuffer =
  | { state: "none" }
  | { state: "closed" }
  /** Reads empty after a failed close: closed, or consumed by the deploy */
  | { state: "gone" }
  /** A create that failed, on an account that could not be read */
  | { state: "unknown"; address: string }
  | { state: "kept"; address: string; sol: number | undefined };

/**
 * The words for an amount a kept buffer holds, to two decimals as the session
 * footer's `formatBalance` shows a wallet's; under 0.005 SOL reads "less than
 * 0.01 SOL", and an unread balance "its SOL"
 */
const heldWords = (sol: number | undefined) => {
  if (sol === undefined) return "its SOL";
  const shown = sol.toFixed(2);
  return shown === "0.00" ? "less than 0.01 SOL" : `${shown} SOL`;
};

/**
 * What the terminal says after a stopped deploy (Spec 13's "Stopped. The
 * program was not deployed."), naming what the stop left behind.
 *
 * @param buffer the buffer account: never created, closed on the stop, or
 * kept because closing it failed, with the SOL it still holds
 * (`undefined` when they could not be read). A stop locks out the final
 * deploy, so after a stop a buffer that reads empty was closed.
 * @returns the line for `StoppedError`
 */
export const deployStoppedLine = (buffer: StoppedBuffer) =>
  [
    `${STOPPED} The program was not deployed.`,
    bufferLeftLine(buffer.state === "gone" ? { state: "closed" } : buffer),
  ]
    .filter(Boolean)
    .join(" ");

/**
 * What a deploy that ended early, stopped or failed, left of its buffer
 * account: nothing to say when it was never created. `gone` is said as it is:
 * the deploy may have consumed the buffer, or the close may have landed.
 */
export const bufferLeftLine = (buffer: StoppedBuffer) => {
  switch (buffer.state) {
    case "none":
      return "";
    case "closed":
      return "Its buffer account was closed and the SOL returned.";
    case "gone":
      return "Its buffer account no longer exists; check whether the program was deployed.";
    case "unknown":
      return [
        `Could not check whether its buffer ${buffer.address} was created.`,
        "If it holds SOL, run `solana program close --buffers` to get it back.",
      ].join(" ");
    case "kept":
      return [
        `Its buffer ${buffer.address} still holds ${heldWords(buffer.sol)}.`,
        "Run `solana program close --buffers` to get it back.",
      ].join(" ");
  }
};
