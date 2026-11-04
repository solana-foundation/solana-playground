/** The wallet storage failures the user is told about, once a page load */
export type WalletNoticeKind = "save-failed" | "set-aside";

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
