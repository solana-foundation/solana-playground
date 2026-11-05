import { STOPPED } from "../../utils/stopped";

/** What a stopped deploy left of its buffer account */
export type StoppedBuffer =
  | { state: "none" }
  | { state: "closed" }
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
 * (`undefined` when they could not be read)
 * @returns the line for `StoppedError`
 */
export const deployStoppedLine = (buffer: StoppedBuffer) => {
  const line = `${STOPPED} The program was not deployed.`;
  switch (buffer.state) {
    case "none":
      return line;
    case "closed":
      return `${line} Its buffer account was closed and the SOL returned.`;
    case "kept":
      return [
        line,
        `Its buffer ${buffer.address} still holds ${heldWords(buffer.sol)}.`,
        "Run `solana program close --buffers` to get it back.",
      ].join(" ");
  }
};
