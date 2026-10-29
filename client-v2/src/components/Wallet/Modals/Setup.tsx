import { useState } from "react";
import { TriangleAlertIcon } from "lucide-react";
import styled, { css } from "styled-components";

import { AsyncButton } from "@/shared/ui/async-button";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { ModalFrame } from "@/widgets/overlays";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import { PgWallet, PgWeb3 } from "../../../utils";
import { KeypairFileError } from "../../../utils/wallet/keypair-file";
import { createLogger } from "@/shared/lib/logger";

const log = createLogger("wallet:setup");

export const Setup = () => {
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
        setText("Imported address: " + imported.keypair.publicKey.toBase58());
      }
    } catch (err) {
      if (err instanceof KeypairFileError) {
        setText(err.message);
        return;
      }
      log.error(err, { report: true });
      setText(
        "Could not import the keypair: " +
          (err instanceof Error ? err.message : String(err))
      );
    }
  };

  return (
    <ModalFrame
      name="wallet-setup"
      title="Playground Wallet"
      buttonProps={{
        text: "Continue",
        onSubmit: handleSetup,
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
            Wallet information is stored in your browser's local storage. You
            are going to lose the wallet if you clear your browser history
            unless you save the keypair.
          </CalloutDescription>
        </Callout>
        <WalletButtonsWrapper>
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
        </WalletButtonsWrapper>
        {text && <KeypairText>{text}</KeypairText>}
      </Content>
    </ModalFrame>
  );
};

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

  & button {
    margin-right: 1rem;
  }
`;

const KeypairText = styled.div`
  ${({ theme }) => css`
    margin-top: 1rem;
    font-size: ${theme.font.code.size.small};
    color: ${theme.colors.default.textSecondary};
  `}
`;
