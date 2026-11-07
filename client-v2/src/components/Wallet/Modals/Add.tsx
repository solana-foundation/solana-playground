import { InfoIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import styled, { css } from "styled-components";

import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { AsyncButton } from "@/shared/ui/async-button";
import { Button } from "@/shared/ui/button";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import { ModalFrame } from "@/widgets/overlays";

import { PgWallet, PgWeb3 } from "../../../utils";
import Input from "../../Input";
import { useDraftKey } from "../hooks";
import { KeyPanel, KeyPanelUnavailable } from "../KeyPanel";

/** The Add dialog for the wallet's provider: keys in the page, or on the key origin */
export const Add = () =>
  PgWallet.holdsKeysInPage() ? <LocalAdd /> : <KeyOriginAdd />;

/** Under the `local` provider: the keypair is made and saved in the page */
const LocalAdd = () => {
  const [keypair] = useState(PgWeb3.Keypair.generate);
  return (
    <AddBody onSubmit={(name) => PgWallet.add({ name, keypair })}>
      {(name) => (
        <AsyncButton
          type="button"
          variant="outline"
          onClick={() => PgWallet.export({ name, keypair })}
          onError={reportButtonFailure("save the keypair")}
        >
          Save keypair
        </AsyncButton>
      )}
    </AddBody>
  );
};

/**
 * Under the `key-origin` provider: the key is made in the key page when the
 * dialog opens and its file saved by the key page's panel; closing without
 * creating drops it (`useDraftKey`)
 */
const KeyOriginAdd = () => {
  const draft = useDraftKey();
  const [error, setError] = useState("");
  return (
    <AddBody
      onSubmit={async (name) =>
        PgWallet.add({ name, publicKey: await draft.made() })
      }
    >
      {(name) => (
        <>
          {draft.isFailed ? (
            <KeyPanelUnavailable className="mt-2" />
          ) : draft.publicKey ? (
            <KeyPanel
              action="export"
              publicKey={draft.publicKey}
              name={name}
              onError={setError}
              className="mt-2"
            />
          ) : (
            // The key is being made: the button's place, as it will look
            <Button type="button" variant="outline" disabled>
              Save keypair
            </Button>
          )}
          {error && <Desc>{error}</Desc>}
        </>
      )}
    </AddBody>
  );
};

/** What both Adds show: the name, the callout, and the key file's button */
const AddBody = ({
  onSubmit,
  children,
}: {
  onSubmit: (name: string) => unknown;
  children: (name: string) => ReactNode;
}) => {
  const [name, setName] = useState(() => {
    // Passing `PgWallet.getNextAvailableAccountName` directly to the `useState`
    // makes the name incorrect (n+1 name)
    return PgWallet.getNextAvailableAccountName();
  });
  const [error, setError] = useState("");

  return (
    <ModalFrame
      name="wallet-add"
      title
      buttonProps={{
        text: "Create",
        onSubmit: () => onSubmit(name),
        disabled: !!error,
      }}
    >
      <MainContent>
        <MainText>Are you sure you want to create a new wallet?</MainText>
        <Desc>This will create a brand new keypair.</Desc>

        <InputWrapper>
          <InputLabel>Account name</InputLabel>
          <Input
            value={name}
            onChange={(ev) => setName(ev.target.value)}
            validator={PgWallet.validateAccountName}
            error={error}
            setError={setError}
          />
        </InputWrapper>

        <Callout variant="info" className="mt-4">
          <InfoIcon />
          <CalloutDescription>
            Saving the keypair will allow you to recover the wallet.
          </CalloutDescription>
        </Callout>
        {children(name)}
      </MainContent>
    </ModalFrame>
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
    margin-top: 0.5rem;
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

const InputWrapper = styled.div`
  margin-top: 0.75rem;
`;

const InputLabel = styled.div`
  margin-bottom: 0.25rem;
  font-weight: bold;
`;
