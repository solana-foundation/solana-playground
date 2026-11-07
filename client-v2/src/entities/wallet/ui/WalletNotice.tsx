/** The wallet storage failures the user is told about, once a page load */
export type WalletNoticeKind =
  | "save-failed"
  | "set-aside"
  | "first-account-failed"
  | "forget-failed";

/** Each notice's lead sentence, and what follows it */
const NOTICES: Record<WalletNoticeKind, { title: string; detail?: string }> = {
  "save-failed": {
    title: "Your wallet could not be saved.",
    detail:
      "Changes are kept until you reload; export your keypair to keep it.",
  },
  "set-aside": {
    title: "Some wallet accounts could not be read and were set aside.",
  },
  "first-account-failed": {
    title: "Your wallet's first account could not be made.",
    detail: "Reload the page and try again.",
  },
  "forget-failed": {
    title: "A removed account's key could not be deleted.",
    detail:
      "The account is gone from your wallet, but its key is still stored in this browser.",
  },
};

export interface WalletNoticeProps {
  notice: WalletNoticeKind;
}

/** A toast's text for a wallet storage failure (`utils/wallet/wallet.ts`) */
export const WalletNotice = ({ notice }: WalletNoticeProps) => {
  const { title, detail } = NOTICES[notice];
  return (
    <span>
      <strong>{title}</strong>
      {detail && ` ${detail}`}
    </span>
  );
};
