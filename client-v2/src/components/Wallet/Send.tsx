import { useEffect, useRef, useState } from "react";
import styled, { css } from "styled-components";

import { AsyncButton } from "@/shared/ui/async-button";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import Input from "../Input";
import {
  Collapsible,
  CollapsibleChevron,
  CollapsibleContent,
  CollapsibleHeading,
} from "@/shared/ui/collapsible";
import {
  PgCommon,
  PgTerminal,
  PgTheme,
  PgTx,
  PgWallet,
  PgWeb3,
} from "../../utils";
import { useBalance, useKeybind } from "../../hooks";

const Send = () => (
  <Wrapper>
    <Collapsible>
      <CollapsibleHeading>
        <CollapsibleChevron />
        <Title>Send</Title>
      </CollapsibleHeading>
      <CollapsibleContent className="mt-2">
        <SendExpanded />
      </CollapsibleContent>
    </Collapsible>
  </Wrapper>
);

const Wrapper = styled.div`
  ${({ theme }) => css`
    ${PgTheme.convertToCSS(theme.components.wallet.main.send.default)};
  `}
`;

const Title = styled.span`
  ${({ theme }) => css`
    ${PgTheme.convertToCSS(theme.components.wallet.main.send.title)};
  `}
`;

const SendExpanded = () => {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [disabled, setDisabled] = useState(true);

  const balance = useBalance();

  // Send button disable
  useEffect(() => {
    setDisabled(
      !(
        PgCommon.isPk(recipient) &&
        PgCommon.isFloat(amount) &&
        balance &&
        balance > parseFloat(amount)
      )
    );
  }, [recipient, amount, balance]);

  const send = async () => {
    if (disabled) return;

    await PgTerminal.process(async () => {
      PgTerminal.println(
        PgTerminal.info(`Sending ${amount} SOL to ${recipient}...`)
      );

      const ix = PgWeb3.SystemProgram.transfer({
        fromPubkey: PgWallet.current!.publicKey,
        toPubkey: new PgWeb3.PublicKey(recipient),
        lamports: PgWeb3.solToLamports(parseFloat(amount)),
      });
      const txHash = await PgTx.send(ix);
      const txResult = await PgCommon.transition(PgTx.confirm(txHash));
      if (txResult?.err) throw txResult.err;

      PgTerminal.println(PgTerminal.success("Success."));

      // Reset inputs
      setRecipient("");
      setAmount("");
    });
  };

  const recipientInputRef = useRef<HTMLInputElement>(null);
  const amountInputRef = useRef<HTMLInputElement>(null);
  useKeybind("Enter", {
    handle: () => {
      // Only send if one of the inputs is in focus
      switch (document.activeElement) {
        case recipientInputRef.current:
        case amountInputRef.current:
          // The button's `onError` does not see a send started by a key
          return send().catch(reportButtonFailure("send SOL"));
      }
    },
    // Make `Enter` usable elsewhere (e.g. editor new line)
    opts: { noPreventDefault: true },
  });

  return (
    <ExpandedWrapper>
      <ExpandedInput
        ref={recipientInputRef}
        value={recipient}
        onChange={(ev) => setRecipient(ev.target.value)}
        validator={PgCommon.isPk}
        placeholder="Recipient address"
      />
      <ExpandedInput
        ref={amountInputRef}
        value={amount}
        onChange={(ev) => setAmount(ev.target.value)}
        validator={(input) => {
          if (
            !PgCommon.isFloat(input) ||
            (balance && parseFloat(input) > balance)
          ) {
            throw new Error("Invalid amount");
          }
        }}
        placeholder="SOL amount"
      />
      <AsyncButton
        onClick={send}
        onError={reportButtonFailure("send SOL")}
        disabled={disabled}
        loadingText="Sending..."
        variant="ghost"
        className="mb-1 w-full"
      >
        Send
      </AsyncButton>
    </ExpandedWrapper>
  );
};

const ExpandedWrapper = styled.div`
  ${({ theme }) => css`
    ${PgTheme.convertToCSS(theme.components.wallet.main.send.expanded.default)};
  `}
`;

const ExpandedInput = styled(Input)`
  ${({ theme }) => css`
    ${PgTheme.convertToCSS(theme.components.wallet.main.send.expanded.input)};
  `}
`;

export default Send;
