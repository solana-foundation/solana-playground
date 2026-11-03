import { STOPPED } from "../../utils/stopped";

/** What a stopped deploy left of its buffer account */
export type StoppedBuffer =
  | { state: "none" }
  | { state: "closed" }
  | { state: "kept"; address: string };

/**
 * What the terminal says after a stopped deploy (Spec 13's "Stopped. The
 * program was not deployed."), naming what the stop left behind.
 *
 * @param buffer the buffer account: never created, closed on the stop, or
 * kept because closing it failed
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
        `The buffer account ${buffer.address} still holds its SOL;`,
        "run `solana program close --buffers` to reclaim it.",
      ].join(" ");
  }
};
