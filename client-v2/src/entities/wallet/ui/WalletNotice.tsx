/** The wallet storage failures the user is told about, once a page load */
export type WalletNoticeKind = "save-failed";

const NOTICES: Record<WalletNoticeKind, { title: string; detail: string }> = {
  "save-failed": {
    title: "Your wallet could not be saved.",
    detail:
      "Changes are kept until you reload; export your keypair to keep it.",
  },
};

export interface WalletNoticeProps {
  notice: WalletNoticeKind;
}

/** A toast's text for a wallet storage failure (`utils/wallet/wallet.ts`) */
export const WalletNotice = ({ notice }: WalletNoticeProps) => (
  <span>
    <strong>{NOTICES[notice].title}</strong> {NOTICES[notice].detail}
  </span>
);
