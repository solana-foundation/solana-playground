import type { AirdropVia } from "../../features/fund-wallet";

/**
 * The callers of the `airdrop` runs in flight, for `fund_airdropped`. The
 * command cannot tell who ran it, so a caller names itself around `execute`
 * through `withAirdropVia`; the terminal names nobody and is the default.
 *
 * The runs share this module, and nothing queues them: a deploy's top-up can
 * start the automatic airdrop, and the Flow state counts airdrops in flight
 * because they overlap (`views/flow/state/stage.ts`, `airdrops`). A run reads
 * the latest caller when its `handle` starts, so two overlapping runs can
 * both carry the later one's `via`; the event takes that chance over a
 * parameter the terminal cannot pass. Each run removes its own entry when it
 * settles, whatever the order, so no caller outlives its run.
 */
const pending: { via: AirdropVia }[] = [];

/** The caller of the latest airdrop in flight; `terminal` when none named itself */
export const getAirdropVia = (): AirdropVia =>
  pending.at(-1)?.via ?? "terminal";

/**
 * Runs `run` as the airdrop caller `via`, drops that caller when it settles,
 * and resolves with what `run` resolves with
 */
export const withAirdropVia = async <T>(
  run: () => Promise<T>,
  via: AirdropVia
): Promise<T> => {
  const entry = { via };
  pending.push(entry);
  try {
    return await run();
  } finally {
    pending.splice(pending.indexOf(entry), 1);
  }
};
