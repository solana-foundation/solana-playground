import { useState } from "react";
import styled, { css } from "styled-components";

import { createLogger } from "@/shared/lib/logger";
import { ModalFrame, useModalId } from "@/widgets/overlays";

import { PgView, PgWallet } from "../../../utils";
import { useBusyPanels } from "../hooks";
import { addExistingImportedKey, addNewImportedKey } from "../imported-key";
import { KeyPanel } from "../KeyPanel";

const log = createLogger("wallet:key-file");

/**
 * Settings' Import under the `key-origin` provider: the key page's panel reads
 * the file and is the dialog's one action. An import closes the dialog and a
 * toast says what it did; a failure stays in the dialog. A Done beside the
 * panel only closed it, and read as the action (user feedback, 26 Nov).
 */
export const ImportKey = () => {
  const id = useModalId();
  const [text, setText] = useState("");
  const { onBusy } = useBusyPanels();
  const handleImported = (publicKey: string, isNew: boolean) => {
    try {
      const imported = isNew
        ? addNewImportedKey(publicKey)
        : addExistingImportedKey(publicKey);
      PgView.closeModal(undefined, id);
      PgView.setToast(() => <span>{imported}</span>, {
        options: { name: "wallet-imported" },
      });
    } catch (err) {
      log.error(err, { report: true });
      setText(
        "Could not import the keypair: " +
          (err instanceof Error ? err.message : String(err))
      );
    }
  };
  return (
    <ModalFrame name="wallet-import" title="Import keypair">
      <MainContent>
        <Desc>Pick a .json file saved from Playground or the Solana CLI.</Desc>
        <KeyPanel
          action="import"
          look="primary"
          onImported={handleImported}
          onError={setText}
          onBusy={onBusy}
          className="mt-6 self-end"
        />
        {text && <Desc>{text}</Desc>}
      </MainContent>
    </ModalFrame>
  );
};

/**
 * Settings' Export under the `key-origin` provider: the key page's panel saves
 * the current account's file and is the dialog's one action; a save closes
 * the dialog
 */
export const ExportKey = () => {
  const id = useModalId();
  const [text, setText] = useState("");
  const { onBusy } = useBusyPanels();
  const current = PgWallet.accounts[PgWallet.currentIndex];
  return (
    <ModalFrame name="wallet-export" title="Export keypair">
      <MainContent>
        <Desc>
          Save {current?.name ?? "the wallet"}'s keypair to recover the wallet
          later.
        </Desc>
        {current && (
          <KeyPanel
            action="export"
            look="primary"
            publicKey={current.publicKey}
            name={current.name}
            onError={setText}
            onExported={() => PgView.closeModal(undefined, id)}
            onBusy={onBusy}
            className="mt-6 self-end"
          />
        )}
        {text && <Desc>{text}</Desc>}
      </MainContent>
    </ModalFrame>
  );
};

const MainContent = styled.div`
  display: flex;
  flex-direction: column;
  padding: 0 1rem;
`;

const Desc = styled.span`
  ${({ theme }) => css`
    font-size: ${theme.font.code.size.small};
    color: ${theme.colors.default.textSecondary};
    margin-top: 0.5rem;

    &:first-child {
      margin-top: 0;
    }
  `}
`;
