import { useEffect, useState } from "react";
import styled, { css } from "styled-components";

import IdlActions from "./IdlActions";
import Button from "../../../components/Button";
import Link from "../../../components/Link";
import GradientButton from "../../../components/GradientButton";
import {
  useBlockExplorer,
  useProgramInfo,
  useRenderOnChange,
} from "../../../hooks";
import {
  PgCommand,
  PgConnection,
  PgExplorer,
  PgGlobal,
  PgProgramInfo,
  PgTheme,
} from "../../../utils";
import { PgDeployHistory } from "../state/deploy-history";
import type { DeployRecord } from "../state/deploy-history";
import { PgFlow } from "../state/stage";
import type { FlowState } from "../state/stage";

const Deploy = () => {
  const [flow, setFlow] = useState<FlowState>(PgFlow.state);
  const [history, setHistory] = useState<DeployRecord[]>([]);
  const explorer = useBlockExplorer();
  const programInfo = useProgramInfo();
  const deployState = useRenderOnChange(PgGlobal.onDidChangeDeployState);
  useRenderOnChange(PgConnection.onDidChangeCluster);

  useEffect(() => {
    const refresh = () =>
      setHistory(PgDeployHistory.list(PgExplorer.currentWorkspaceName ?? ""));
    const a = PgFlow.onDidChange(setFlow);
    const b = PgDeployHistory.onDidChange(refresh);
    const c = PgExplorer.onDidSwitchWorkspace(refresh);
    return () => {
      a.dispose();
      b.dispose();
      c.dispose();
    };
  }, []);

  const built = flow.build === "done";
  // A second click on Deploy while one is already running pauses it
  // (`deployState` becomes "paused") rather than starting a new one, which
  // upstream's sidebar exposes as an explicit "Continue"/pause toggle. Flow
  // does not offer that control, so a click here would either be a no-op
  // that returns without deploying or an unintended pause -- disable the
  // button instead of risking either.
  const deploying = deployState === "loading";
  const latest = history[0] ?? null;
  const onChain = programInfo.onChain;
  const cluster = PgConnection.cluster;
  const n = history.length;
  const meta = [cluster, `${n} deployment${n === 1 ? "" : "s"}`]
    .filter(Boolean)
    .join(" \u00b7 ");

  const description = !built
    ? "Build the program first -- the stepper unlocks Deploy once it " +
      "compiles cleanly."
    : latest
    ? "The program id stays constant across deploys; redeploying upgrades " +
      "it in place."
    : `Nothing deployed yet. Deploying sends the compiled program to ` +
      `${cluster} using the connected wallet.`;

  return (
    <Surface>
      <HeaderRow>
        <HeaderText>
          <Headline>
            <ReadyGlyph
              $ready={built}
              viewBox="0 0 14 14"
              width="16"
              height="16"
              aria-hidden
            >
              <circle cx="7" cy="7" r="6" />
            </ReadyGlyph>
            Deploy
          </Headline>
          <Meta>{meta}</Meta>
        </HeaderText>
      </HeaderRow>
      <Muted>{description}</Muted>
      {flow.deploy === "failed" && (
        <ErrorNotice role="alert">Deploy failed - see the console.</ErrorNotice>
      )}

      <Actions>
        <GradientButton
          disabled={!built || deploying}
          title={
            !built
              ? "Build successfully first"
              : deploying
              ? "A deploy is already running"
              : undefined
          }
          onClick={() => {
            // Interact's deployment switcher may have pointed the project
            // at an imported id; redeploying always targets the project's
            // own key, never whatever Interact last selected.
            PgProgramInfo.update({ customPk: null });
            PgCommand.deploy.execute();
          }}
        >
          {deploying
            ? latest
              ? "Upgrading..."
              : "Deploying..."
            : latest
            ? `Redeploy to ${cluster}`
            : `Deploy to ${cluster}`}
        </GradientButton>
        <IdlActions showUpload />
      </Actions>
      {built && !latest && programInfo.pk && (
        <Muted>Program id: {programInfo.pk.toBase58()}</Muted>
      )}

      {latest && (
        <Card>
          <Eyebrow>Latest deployment</Eyebrow>
          <Row>
            <Key>Program id</Key>
            <Mono title={latest.programId}>{latest.programId}</Mono>
            <Button.Copy copyText={latest.programId} />
            <Link
              href={explorer.getAddressUrl(latest.programId)}
              aria-label={`View latest deployment (${latest.programId}) on Explorer`}
            >
              Explorer
            </Link>
          </Row>
          <Row>
            <Key>Cluster</Key>
            <Chip>{latest.cluster}</Chip>
          </Row>
          {latest.signature && (
            <Row>
              <Key>Transaction</Key>
              <Mono>{latest.signature.slice(0, 20)}&hellip;</Mono>
              <Link
                href={explorer.getTxUrl(latest.signature)}
                aria-label={
                  `View latest deployment transaction ` +
                  `(${latest.signature}) on Explorer`
                }
              >
                Explorer
              </Link>
            </Row>
          )}
          {onChain?.deployed && (
            <Row>
              <Key>Upgradable</Key>
              <Mono>{onChain.upgradable ? "Yes" : "No"}</Mono>
            </Row>
          )}
          {onChain?.deployed && onChain.upgradable && onChain.authority && (
            <Row>
              <Key>Authority</Key>
              <Mono title={onChain.authority.toBase58()}>
                {onChain.authority.toBase58()}
              </Mono>
            </Row>
          )}
          {onChain?.deployed &&
            onChain.upgradable &&
            onChain.programDataLen !== undefined && (
              <Row>
                <Key>Program size</Key>
                <Mono>{onChain.programDataLen.toLocaleString()} bytes</Mono>
              </Row>
            )}
          <Row>
            <Key>When</Key>
            <Time>{new Date(latest.at).toLocaleString()}</Time>
          </Row>
          <Actions>
            <Button onClick={() => PgFlow.setStage("interact")}>
              Interact
            </Button>
          </Actions>
        </Card>
      )}

      <Card as="section">
        <Eyebrow>History</Eyebrow>
        {history.length === 0 && (
          <Muted>No deployments yet for this project.</Muted>
        )}
        {history.length > 0 && (
          <List>
            {history.map((r) => (
              <HistoryRow key={r.id}>
                <Chip>{r.cluster}</Chip>
                <Mono title={r.programId}>
                  {r.programId.slice(0, 8)}&hellip;{r.programId.slice(-4)}
                </Mono>
                <Time>{new Date(r.at).toLocaleString()}</Time>
                <Link
                  href={explorer.getAddressUrl(r.programId)}
                  aria-label={`View deployment (${r.programId}) on Explorer`}
                >
                  Explorer
                </Link>
              </HistoryRow>
            ))}
          </List>
        )}
      </Card>
    </Surface>
  );
};

export default Deploy;

const Surface = styled.div`
  ${({ theme }) => css`
    height: 100%;
    overflow-y: auto;
    padding: 2rem 1.75rem;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.75rem;
    font-family: ${theme.font.other.family};
    color: ${theme.colors.default.textPrimary};
  `}
`;

const HeaderRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  width: 100%;
  max-width: 42rem;
`;

const HeaderText = styled.div`
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.625rem;
`;

const Meta = styled.span`
  ${({ theme }) => css`
    font-family: ${theme.font.code.family};
    font-size: ${theme.font.other.size.small};
    color: ${theme.colors.default.textSecondary};
  `}
`;

const Eyebrow = styled.div`
  ${({ theme }) => css`
    font-size: ${theme.font.other.size.xsmall};
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: ${theme.colors.default.textSecondary};
  `}
`;

const ErrorNotice = styled.p`
  ${({ theme }) => css`
    margin: 0;
    padding: 0.5rem 0.75rem;
    border: 1px solid ${theme.colors.state.error.color};
    border-radius: ${theme.default.borderRadius};
    background: ${PgTheme.alpha(theme.colors.state.error.color, "high")};
    color: ${theme.colors.state.error.color};
    font-size: ${theme.font.other.size.small};
  `}
`;

const ReadyGlyph = styled.svg<{ $ready: boolean }>`
  ${({ theme, $ready }) => css`
    flex-shrink: 0;

    circle {
      fill: ${$ready ? theme.colors.state.success.color : "none"};
      stroke: ${$ready
        ? theme.colors.state.success.color
        : theme.colors.default.border};
      stroke-width: 1.5;
    }
  `}
`;

const Headline = styled.h2`
  ${({ theme }) => css`
    margin: 0;
    display: flex;
    align-items: center;
    gap: 0.625rem;
    font-size: ${theme.font.other.size.xlarge};
    font-weight: 600;
    letter-spacing: -0.01em;
  `}
`;

const Chip = styled.span`
  ${({ theme }) => css`
    display: inline-flex;
    align-items: center;
    padding: 0.125rem 0.5rem;
    border: 1px solid ${theme.colors.default.border};
    border-radius: 999px;
    font-family: ${theme.font.code.family};
    font-size: ${theme.font.code.size.xsmall};
    font-weight: 400;
    color: ${theme.colors.default.textSecondary};
    text-transform: lowercase;
  `}
`;

const Muted = styled.p`
  ${({ theme }) => css`
    margin: 0;
    max-width: 34rem;
    font-size: ${theme.font.other.size.small};
    line-height: 1.55;
    color: ${theme.colors.default.textSecondary};
  `}
`;

const Actions = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.625rem;
  align-items: center;
  margin-top: 0.25rem;
`;

const Card = styled.section`
  ${({ theme }) => css`
    width: 100%;
    max-width: 42rem;
    margin-top: 0.5rem;
    padding: 1.125rem 1.25rem;
    border: 1px solid ${theme.colors.default.border};
    border-radius: ${theme.default.borderRadius};
    background: ${theme.components.tooltip.bg};
    display: flex;
    flex-direction: column;
    gap: 0.625rem;
  `}
`;

const Row = styled.div`
  display: flex;
  gap: 0.75rem;
  align-items: baseline;
`;

const Key = styled.span`
  ${({ theme }) => css`
    flex-shrink: 0;
    width: 7rem;
    font-size: ${theme.font.other.size.small};
    color: ${theme.colors.default.textSecondary};
  `}
`;

const Mono = styled.span`
  ${({ theme }) => css`
    overflow-wrap: anywhere;
    font-family: ${theme.font.code.family};
    font-size: ${theme.font.code.size.small};
    font-variant-numeric: tabular-nums;
  `}
`;

const Time = styled(Mono)`
  color: ${({ theme }) => theme.colors.default.textSecondary};
`;

const List = styled.div`
  display: flex;
  flex-direction: column;
`;

const HistoryRow = styled.div`
  ${({ theme }) => css`
    display: grid;
    grid-template-columns: 6rem 1fr 1fr auto;
    gap: 0.75rem;
    align-items: center;
    padding: 0.5rem 0;
    border-bottom: 1px solid ${theme.colors.default.border};

    &:last-child {
      border-bottom: none;
    }
  `}
`;
