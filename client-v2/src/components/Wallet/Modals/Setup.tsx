import { TriangleAlertIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import styled, { css } from "styled-components";

import { createLogger } from "@/shared/lib/logger";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { AsyncButton } from "@/shared/ui/async-button";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import { ModalFrame } from "@/widgets/overlays";

import { PgWallet, PgWeb3 } from "../../../utils";
import { KeypairFileError } from "../../../utils/wallet/keypair-file";
import { useBusyPanels, useDraftKey } from "../hooks";
import { addImportedKey } from "../imported-key";
import { importedText } from "../imported-text";
import { KeyPanel } from "../KeyPanel";
import { SaveKeyPanel } from "./SaveKeyPanel";

const log = createLogger("wallet:setup");

/** The Setup dialog for the wallet's provider: keys in the page, or on the key origin */
export const Setup = () =>
  PgWallet.hasKeysInPage() ? <LocalSetup /> : <KeyOriginSetup />;

/** Under the `local` provider: the keypair is made and saved in the page */
const LocalSetup = () => {
  const [text, setText] = useState("");
  const [keypair] = useState(PgWeb3.Keypair.generate);

  const handleSetup = () => {
    if (!PgWallet.accounts.length) PgWallet.add({ keypair });
    return true; // Indicate the setup has been completed successfully
  };

  const handleExport = () => {
    if (!PgWallet.accounts.length) {
      PgWallet.export({
        name: PgWallet.getNextAvailableAccountName(),
        keypair,
      });
    } else {
      PgWallet.export();
    }
  };

  const handleImport = async () => {
    setText("");
    try {
      // Never removes the wallet the user already has: the file may be
      // cancelled or not a keypair. `PgWallet.add` switches to an account
      // that is already there.
      const imported = await PgWallet.import();
      if (imported) {
        const { name } = PgWallet.accounts[PgWallet.currentIndex];
        setText(
          importedText(
            {
              publicKey: imported.keypair.publicKey.toBase58(),
              added: imported.added,
            },
            name
          )
        );
      }
    } catch (err) {
      if (err instanceof KeypairFileError) {
        setText(err.message);
        return;
      }
      log.error(err, { report: true });
      setText(importFailure(err));
    }
  };

  return (
    <SetupBody onSubmit={handleSetup} text={text}>
      <AsyncButton
        type="button"
        variant="outline"
        onClick={handleExport}
        onError={reportButtonFailure("save the keypair")}
      >
        Save keypair
      </AsyncButton>
      <AsyncButton
        type="button"
        variant="outline"
        onClick={handleImport}
        onError={reportButtonFailure("import the keypair")}
      >
        Import keypair
      </AsyncButton>
    </SetupBody>
  );
};

/**
 * Under the `key-origin` provider: the key is made in the key page when the
 * dialog opens, and its file is saved, or another imported, by the key page's
 * own panels; the page never holds the key
 */
const KeyOriginSetup = () => {
  const [text, setText] = useState("");
  const draft = useDraftKey();
  const { isBusy, onBusy } = useBusyPanels();

  const handleSetup = async () => {
    if (!PgWallet.accounts.length) {
      PgWallet.add({ publicKey: await draft.made() });
    }
    return true; // Indicate the setup has been completed successfully
  };

  const handleImported = (publicKey: string, isNew: boolean) => {
    try {
      setText(addImportedKey(publicKey, isNew));
    } catch (err) {
      log.error(err, { report: true });
      setText(importFailure(err));
    }
  };

  return (
    <SetupBody onSubmit={handleSetup} text={text} isHeld={isBusy}>
      <SaveKeyPanel
        isFailed={draft.isFailed}
        exported={exportedFor(draft.publicKey)}
        onError={setText}
        onBusy={onBusy}
      />
      <KeyPanel
        action="import"
        onImported={handleImported}
        onError={setText}
        onBusy={onBusy}
      />
    </SetupBody>
  );
};

/**
 * @param made the key the dialog made, once made
 * @returns the account whose file Setup saves: before the first account, the
 * key the dialog made; after an import, the current account, as the local
 * Setup saves
 */
const exportedFor = (made: string | undefined) => {
  const current = PgWallet.accounts[PgWallet.currentIndex];
  if (PgWallet.accounts.length && current) {
    return { publicKey: current.publicKey, name: current.name };
  }
  if (!made) return undefined;
  return { publicKey: made, name: PgWallet.getNextAvailableAccountName() };
};

const importFailure = (err: unknown) =>
  "Could not import the keypair: " +
  (err instanceof Error ? err.message : String(err));

/** What both Setups show: the explanation, the key file's buttons, the result */
const SetupBody = ({
  onSubmit,
  text,
  isHeld = false,
  children,
}: {
  onSubmit: () => boolean | Promise<boolean>;
  text: string;
  /** Continue and Cancel wait, as while a key panel is busy */
  isHeld?: boolean;
  children: ReactNode;
}) => (
  <ModalFrame
    name="wallet-setup"
    title="Playground Wallet"
    buttonProps={{
      text: "Continue",
      onSubmit,
      isHeld,
    }}
  >
    <Content>
      <ContentTitle>What is it?</ContentTitle>
      <ContentText>
        Playground wallet is a native wallet that speeds up development by
        auto-approving transactions.
      </ContentText>
    </Content>
    <Content>
      <ContentTitle>How to setup?</ContentTitle>
      <ContentText>
        You don't need to do anything other than saving the keypair for future
        use. You can also choose to import an existing wallet.
      </ContentText>
      <Callout variant="warning" className="mt-4">
        <TriangleAlertIcon />
        <CalloutDescription>
          Wallet information is stored in your browser. You are going to lose
          the wallet if you clear this site's data unless you save the keypair.
        </CalloutDescription>
      </Callout>
      <WalletButtonsWrapper>{children}</WalletButtonsWrapper>
      {text && <KeypairText>{text}</KeypairText>}
    </Content>
  </ModalFrame>
);

const Content = styled.div`
  padding: 0 1rem;

  &:not(:first-child) {
    margin-top: 1rem;
  }
`;

const ContentTitle = styled.div`
  margin-bottom: 0.25rem;
  font-weight: bold;
`;

const ContentText = styled.p`
  color: ${({ theme }) => theme.colors.default.textSecondary};
`;

const WalletButtonsWrapper = styled.div`
  margin-top: 1rem;
  display: flex;
  gap: 1rem;
`;

const KeypairText = styled.div`
  ${({ theme }) => css`
    margin-top: 1rem;
    font-size: ${theme.font.code.size.small};
    color: ${theme.colors.default.textSecondary};
  `}
`;
