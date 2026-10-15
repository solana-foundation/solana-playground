import { useState } from "react";
import { InfoIcon } from "lucide-react";
import styled, { css } from "styled-components";

import Input from "../../Input";
import { Button } from "@/shared/ui/button";
import { ModalFrame } from "@/widgets/overlays";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import { PgWallet, PgWeb3 } from "../../../utils";

export const Add = () => {
  const [keypair] = useState(PgWeb3.Keypair.generate);
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
        onSubmit: () => PgWallet.add({ name, keypair }),
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
        <Button
          type="button"
          variant="outline"
          onClick={() => PgWallet.export({ name, keypair })}
        >
          Save keypair
        </Button>
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
