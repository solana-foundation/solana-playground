import { useMemo, type ReactElement } from "react";
import styled from "styled-components";

import { Callout, CalloutDescription } from "@/shared/ui/callout";
import { Pause, Rocket, Triangle } from "../../../../components/Icons";
import { PgCommand, PgGlobal } from "../../../../utils";
import { AsyncButton } from "@/shared/ui/async-button";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import {
  useProgramInfo,
  useRenderOnChange,
  useWallet,
} from "../../../../hooks";

/** The deploy button's icon for each state of a deploy */
const DEPLOY_ICONS: Record<typeof PgGlobal.deployState, ReactElement> = {
  ready: <Rocket data-icon="inline-start" />,
  cancelled: <Rocket data-icon="inline-start" />,
  loading: <Pause data-icon="inline-start" />,
  paused: <Triangle rotate="90deg" data-icon="inline-start" />,
};

const Deploy = () => {
  const buildLoading = useRenderOnChange(PgGlobal.onDidChangeBuildLoading);
  const deployState = useRenderOnChange(PgGlobal.onDidChangeDeployState);

  const programInfo = useProgramInfo();
  const error = !programInfo.onChain;
  const deployed = programInfo.onChain?.deployed;
  const upgradable = programInfo.onChain?.upgradable;
  const hasProgramKp = !!programInfo.kp;
  const hasUuid = !!programInfo.uuid;
  const importedProgram = programInfo.importedProgram;
  const isImportedProgram = !!importedProgram?.bytes.length;

  const wallet = useWallet();
  const hasAuthority = wallet
    ? programInfo.onChain?.authority?.equals(wallet.publicKey)
    : false;

  const deployButtonText = useMemo(() => {
    return deployState === "cancelled"
      ? "Cancelling..."
      : deployState === "paused"
      ? "Continue"
      : deployState === "loading"
      ? deployed
        ? "Upgrading..."
        : "Deploying..."
      : deployed
      ? "Upgrade"
      : "Deploy";
  }, [deployState, deployed]);

  const deployButton = (
    <AsyncButton
      // Not returned: the button must stay pressable while the deploy runs,
      // since a second press pauses it and a third continues it
      onClick={() => {
        PgCommand.deploy.execute().catch(reportButtonFailure);
      }}
      onError={reportButtonFailure}
      disabled={buildLoading}
      loading={deployState === "cancelled"}
    >
      {DEPLOY_ICONS[deployState]}
      {deployButtonText}
    </AsyncButton>
  );

  // First time state
  if (!deployed && !hasProgramKp) {
    if (!isImportedProgram) return null;

    return (
      <Wrapper>
        <Callout>
          <CalloutDescription>
            Initial deployment needs a keypair. You can import it from
            <Bold> Program ID</Bold> settings.
          </CalloutDescription>
        </Callout>
      </Wrapper>
    );
  }

  if (error) {
    return (
      <Wrapper>
        <Callout variant="error">
          <CalloutDescription>
            Connection error. Please try changing the RPC endpoint from the
            settings.
          </CalloutDescription>
        </Callout>
      </Wrapper>
    );
  }

  if (!wallet) {
    return (
      <Wrapper>
        <Callout>
          <CalloutDescription>
            Your wallet must be connected for program deployments.
          </CalloutDescription>
        </Callout>
        <AsyncButton
          onClick={() => PgCommand.connect.execute()}
          onError={reportButtonFailure}
        >
          Connect to Playground Wallet
        </AsyncButton>
      </Wrapper>
    );
  }

  if (!hasUuid && !isImportedProgram) {
    return (
      <Wrapper>
        <Callout>
          <CalloutDescription>
            Build the program first or import a program from
            <Bold> Program binary</Bold>.
          </CalloutDescription>
        </Callout>
      </Wrapper>
    );
  }

  if (upgradable === false) {
    return (
      <Wrapper>
        <Callout variant="warning">
          <CalloutDescription>
            The program is not upgradable.
          </CalloutDescription>
        </Callout>
      </Wrapper>
    );
  }

  if (hasAuthority === false) {
    return (
      <Wrapper>
        <Callout variant="warning">
          <CalloutDescription>
            You don't have the authority to upgrade this program.
          </CalloutDescription>
        </Callout>
      </Wrapper>
    );
  }

  // Custom(uploaded) program deploy
  if (isImportedProgram) {
    const text =
      deployState === "cancelled"
        ? `Cancelling the ${deployed ? "upgrade" : "deployment"} of ${
            importedProgram.fileName
          }...`
        : deployState === "loading"
        ? `${deployed ? "Upgrading" : "Deploying"} ${
            importedProgram.fileName
          }...`
        : ` Ready to ${deployed ? "upgrade" : "deploy"} ${
            importedProgram.fileName
          }`;

    return (
      <Wrapper>
        <Callout>
          <CalloutDescription>{text}</CalloutDescription>
        </Callout>
        {deployButton}
      </Wrapper>
    );
  }

  return <Wrapper>{deployButton}</Wrapper>;
};

const Wrapper = styled.div`
  display: flex;
  flex-direction: column;
  justify-content: center;
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid ${({ theme }) => theme.colors.default.border};

  & div:first-child + button {
    margin-top: 1.5rem;
  }
`;

const Bold = styled.span`
  font-weight: bold;
`;

export default Deploy;
