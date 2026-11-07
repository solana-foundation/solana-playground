import { useState } from "react";
import styled, { css } from "styled-components";

import { createLogger } from "@/shared/lib/logger";
import { ModalFrame } from "@/widgets/overlays";

import { PgWallet } from "../../../utils";
import { addImportedKey } from "../imported-key";
import { KeyPanel } from "../KeyPanel";

const log = createLogger("wallet:key-file");

/**
 * Settings' Import under the `key-origin` provider: the key page's panel reads
 * the file, and the dialog says what the import did
 */
export const ImportKey = () => {
  const [text, setText] = useState("");
  const handleImported = (publicKey: string) => {
    try {
      setText(addImportedKey(publicKey));
    } catch (err) {
      log.error(err, { report: true });
      setText(
        "Could not import the keypair: " +
          (err instanceof Error ? err.message : String(err))
      );
    }
  };
  return (
    <ModalFrame
      name="wallet-import"
      title="Import keypair"
      buttonProps={{ text: "Done", noCancel: true }}
    >
      <MainContent>
        <Desc>Pick a .json file saved from Playground or the Solana CLI.</Desc>
        <KeyPanel
          action="import"
          onImported={handleImported}
          onError={setText}
          className="mt-4"
        />
        {text && <Desc>{text}</Desc>}
      </MainContent>
    </ModalFrame>
  );
};

/**
 * Settings' Export under the `key-origin` provider: the key page's panel saves
 * the current account's file
 */
export const ExportKey = () => {
  const [text, setText] = useState("");
  const current = PgWallet.accounts[PgWallet.currentIndex];
  return (
    <ModalFrame
      name="wallet-export"
      title="Export keypair"
      buttonProps={{ text: "Done", noCancel: true }}
    >
      <MainContent>
        <Desc>
          Save {current?.name ?? "the wallet"}'s keypair to recover the wallet
          later.
        </Desc>
        {current && (
          <KeyPanel
            action="export"
            publicKey={current.publicKey}
            name={current.name}
            onError={setText}
            onExported={() => setText("")}
            className="mt-4"
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
