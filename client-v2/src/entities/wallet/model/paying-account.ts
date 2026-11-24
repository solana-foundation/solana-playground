/**
 * The Playground account that pays, named only once there are two or more:
 * with one account the name says nothing. An extension's accounts live in the
 * extension, so it is never named here. The wallet chip and the Deploy stage's
 * payer line both read it, so they cannot disagree.
 */
export const payingAccountName = (
  wallet: { isPg?: boolean; name: string },
  accountCount: number
) => (wallet.isPg && accountCount > 1 ? wallet.name : undefined);
