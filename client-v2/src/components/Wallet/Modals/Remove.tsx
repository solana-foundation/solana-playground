import { TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import styled, { css } from "styled-components";

import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { AsyncButton } from "@/shared/ui/async-button";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import { ModalFrame } from "@/widgets/overlays";

import { PgWallet } from "../../../utils";
import { KeyPanel } from "../KeyPanel";

export const Remove = () => (
  <ModalFrame
    name="wallet-remove"
    title
    buttonProps={{
      text: "Remove",
      variant: "destructive",
      onSubmit: () => PgWallet.remove(),
    }}
  >
    <MainContent>
      <MainText>Are you sure you want to remove the current wallet?</MainText>
      <Desc>This action is irreversible!</Desc>
      <Callout className="mt-4">
        <TriangleAlertIcon />
        <CalloutDescription>
          You can recover the wallet later if you save the keypair.
        </CalloutDescription>
      </Callout>
      {PgWallet.holdsKeysInPage() ? (
        <AsyncButton
          type="button"
          variant="outline"
          onClick={() => PgWallet.export()}
          onError={reportButtonFailure("save the keypair")}
        >
          Save keypair
        </AsyncButton>
      ) : (
        <SaveCurrentKey />
      )}
    </MainContent>
  </ModalFrame>
);

/** Under the `key-origin` provider, the key page's panel saves the current account's file */
const SaveCurrentKey = () => {
  const [error, setError] = useState("");
  const current = PgWallet.accounts[PgWallet.currentIndex];
  return (
    current && (
      <>
        <KeyPanel
          action="export"
          publicKey={current.publicKey}
          name={current.name}
          onError={setError}
          className="mt-4"
        />
        {error && <Desc>{error}</Desc>}
      </>
    )
  );
};

const MainContent = styled.div`
  display: flex;
  flex-direction: column;
  padding: 0 1rem;

  & > a {
    margin-top: 1rem;
  }

  & > button {
    margin-top: 1rem;
    width: fit-content;
  }
`;
const MainText = styled.span`
  font-weight: bold;
`;

const Desc = styled.span`
  ${({ theme }) => css`
    font-size: ${theme.font.code.size.small};
    color: ${theme.colors.default.textSecondary};
    margin-top: 0.5rem;
  `}
`;
