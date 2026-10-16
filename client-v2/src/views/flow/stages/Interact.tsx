import { useEffect, useRef, useState } from "react";
import styled, { css } from "styled-components";

import IdlActions from "./IdlActions";
import Test from "../../sidebar/test/Component/Test";
import { PgExplorer, PgProgramInfo, PgWeb3 } from "../../../utils";
import { PgDeployHistory } from "../state/deploy-history";
import type { DeployRecord } from "../state/deploy-history";

/** Point `PgProgramInfo`'s target at the given deployment. Selecting the
 * record that matches the project's own keypair clears the override so the
 * project's own key stays in charge; any other record wins by import.
 *
 * Deploy history is user-editable `localStorage`, so `programId` isn't
 * guaranteed to be a valid base58 public key -- skip silently (and leave
 * `customPk` untouched) rather than throwing out of a `useEffect`. */
const target = (record: DeployRecord) => {
  const ownPk = PgProgramInfo.kp?.publicKey.toBase58();
  if (record.programId === ownPk) {
    PgProgramInfo.update({ customPk: null });
    return;
  }

  try {
    const customPk = new PgWeb3.PublicKey(record.programId);
    PgProgramInfo.update({ customPk });
  } catch (e) {
    console.error("Invalid deploy record program id", record.programId, e);
  }
};

const Interact = () => {
  const [history, setHistory] = useState<DeployRecord[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  // Whether this component (not the project's own key) is the reason
  // `PgProgramInfo.customPk` is set, so unmounting can hand control back.
  const targetedRef = useRef(false);

  useEffect(() => {
    const refresh = () => {
      const list = PgDeployHistory.list(PgExplorer.currentWorkspaceName ?? "");
      setHistory(list);
      // Only keep the dropdown's own selection in sync here -- picking a
      // deployment to test against is a state-changing action (it points
      // `PgProgramInfo` at a possibly different program id) and must stay
      // behind an explicit choice in `pick`, never happen just because the
      // list refreshed or the tab mounted.
      setSelected((s) => {
        if (s && list.some((r) => r.id === s)) return s;
        return list[0]?.id ?? null;
      });
    };
    const a = PgDeployHistory.onDidChange(refresh);
    const b = PgExplorer.onDidSwitchWorkspace(refresh);
    return () => {
      a.dispose();
      b.dispose();
      if (targetedRef.current) {
        PgProgramInfo.update({ customPk: null });
        targetedRef.current = false;
      }
    };
  }, []);

  const pick = (id: string) => {
    setSelected(id);
    const record = history.find((r) => r.id === id);
    if (record) {
      target(record);
      targetedRef.current = true;
    }
  };

  const selectedIndex = history.findIndex((r) => r.id === selected);
  const selectedRecord = selectedIndex >= 0 ? history[selectedIndex] : null;
  const meta = selectedRecord
    ? [
        selectedIndex === 0 ? "latest" : null,
        selectedRecord.cluster,
        `${selectedRecord.programId.slice(0, 4)}...`,
      ]
        .filter(Boolean)
        .join(" \u00b7 ")
    : "no deployments yet";

  return (
    <Surface>
      <Toolbar>
        <HeaderText>
          <Headline>Interact</Headline>
          <Meta>{meta}</Meta>
        </HeaderText>
        <ToolbarActions>
          <Label>
            Deployment
            <Select
              value={selected ?? ""}
              onChange={(ev) => pick(ev.target.value)}
              disabled={history.length === 0}
            >
              {history.length === 0 && <option value="">none yet</option>}
              {history.map((r, i) => (
                <option key={r.id} value={r.id}>
                  {i === 0 ? "latest \u00b7 " : ""}
                  {r.cluster} {"\u00b7"} {r.programId.slice(0, 6)}&hellip;{" "}
                  {"\u00b7"} {new Date(r.at).toLocaleTimeString()}
                </option>
              ))}
            </Select>
          </Label>
          <IdlActions showUpload />
        </ToolbarActions>
      </Toolbar>
      <Panel>
        <Test />
      </Panel>
    </Surface>
  );
};

export default Interact;

const Surface = styled.div`
  height: 100%;
  display: flex;
  flex-direction: column;
`;

const Toolbar = styled.div`
  ${({ theme }) => css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 1rem;
    padding: 0.75rem 1.5rem;
    border-bottom: 1px solid ${theme.colors.default.border};
    font-family: ${theme.font.other.family};
  `}
`;

const HeaderText = styled.div`
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.625rem;
`;

const Headline = styled.h2`
  ${({ theme }) => css`
    margin: 0;
    font-size: ${theme.font.other.size.xlarge};
    font-weight: 600;
    letter-spacing: -0.01em;
  `}
`;

const Meta = styled.span`
  ${({ theme }) => css`
    font-family: ${theme.font.code.family};
    font-size: ${theme.font.other.size.small};
    color: ${theme.colors.default.textSecondary};
  `}
`;

const ToolbarActions = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 1rem;
`;

const Label = styled.label`
  ${({ theme }) => css`
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: ${theme.font.other.size.small};
    color: ${theme.colors.default.textSecondary};
  `}
`;

const Select = styled.select`
  ${({ theme }) => css`
    padding: 0.375rem 0.5rem;
    border: 1px solid ${theme.colors.default.border};
    border-radius: ${theme.default.borderRadius};
    background: ${theme.colors.default.bgSecondary};
    color: ${theme.colors.default.textPrimary};
    font-family: ${theme.font.code.family};
    font-size: ${theme.font.code.size.small};
    font-variant-numeric: tabular-nums;

    &:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    &:focus-visible {
      outline: 2px solid ${theme.colors.default.primary};
      outline-offset: 1px;
    }
  `}
`;

const Panel = styled.div`
  flex: 1;
  overflow-y: auto;
`;
