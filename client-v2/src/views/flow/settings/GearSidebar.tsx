import { FC, useEffect, useRef, useState } from "react";
import styled, { css } from "styled-components";

import UpstreamSettings from "../../../app/Panels/Side/Left/Settings";
import {
  Close,
  ExportFile,
  Github,
  ImportFile,
} from "../../../components/Icons";
import Link from "../../../components/Link";
import { Segmented, SegmentedItem } from "@/shared/ui/segmented";
import { AsyncButton } from "@/shared/ui/async-button";
import { Button } from "@/shared/ui/button";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { Endpoint, PLATFORM_ENDPOINTS } from "../../../constants";
import {
  useBlockExplorer,
  useOnClickOutside,
  useProgramInfo,
  useRenderOnChange,
  useSetStatic,
  useWallet,
} from "../../../hooks";
import {
  PgCommon,
  PgFramework,
  PgProgramInfo,
  PgSettings,
  PgView,
} from "../../../utils";
import {
  ImportFs,
  ImportGithub,
} from "../../sidebar/explorer/Component/Modals";

/** Which control the panel puts focus on when it opens */
export type SettingsFocus = "panel" | "network";

/**
 * Marks the controls that toggle this panel, so `useOnClickOutside` does not
 * read a click on one as an outside click.
 */
export const SETTINGS_TRIGGER_ATTR = "data-settings-trigger";

interface GearSidebarProps {
  open: boolean;
  onClose: () => void;
  focus?: SettingsFocus;
}

// `string`, not `Endpoint`: platform endpoints are build-time URLs, not enum
// members.
const NETWORKS: ReadonlyArray<{ label: string; endpoint: string }> = [
  { label: "Devnet", endpoint: Endpoint.DEVNET },
  { label: "Testnet", endpoint: Endpoint.TESTNET },
  { label: "Localnet", endpoint: Endpoint.LOCALNET },
  ...PLATFORM_ENDPOINTS.map(({ name, value }) => ({
    label: name,
    endpoint: value,
  })),
];

export const BaseNetworkChoice: FC<{
  endpoint: string;
  onPick: (endpoint: string) => void;
  groupRef?: React.Ref<HTMLDivElement>;
}> = ({ endpoint, onPick, groupRef }) => {
  const listed = NETWORKS.some((n) => n.endpoint === endpoint);
  return (
    <Segmented
      ref={groupRef}
      variant="chips"
      aria-label="Network"
      value={listed ? endpoint : ""}
      onValueChange={onPick}
    >
      {NETWORKS.map((n) => (
        <SegmentedItem
          key={n.endpoint}
          value={n.endpoint}
          className="font-mono"
        >
          {n.label}
        </SegmentedItem>
      ))}
    </Segmented>
  );
};

/**
 * The Flow layout's settings overlay: network quick-switch, project export
 * and import, Explorer shortcuts, then the upstream declarative settings
 * form (connection, build, editor, notification, block-explorer, ...).
 */
const GearSidebar: FC<React.PropsWithChildren<GearSidebarProps>> = ({
  open,
  onClose,
  focus = "panel",
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const returnFocusTo = useRef<HTMLElement | null>(null);

  // Modals opened from this panel (Import from GitHub/files, and the
  // upstream Settings' own "Custom" value modal) render in `ModalHost`'s
  // dialog, which portals to `body`. That is not a descendant of this panel,
  // and not the portal `useOnClickOutside` already excludes. Without this,
  // the very first click inside such a modal (e.g. focusing its input) reads
  // as an "outside" click and slides this panel shut behind the dialog.
  // This tracks the latest MODAL_SET event, not a modal stack.
  const [modalOpen, setModalOpen] = useState(false);
  useSetStatic(
    PgCommon.getSendAndReceiveEventNames(PgView.events.MODAL_SET).send,
    (detail: { elementable: unknown } | null) =>
      setModalOpen(!!detail?.elementable)
  );

  // The settings triggers are excluded (the footer's cluster row and account
  // row, the rail's dot and Account, the account menu's Settings and cluster
  // warning): this hook fires on `mousedown`, so without that a toggle's own
  // `click` would re-open what the `mousedown` just closed -- one render each
  // way, which reads as the panel wiggling.
  useOnClickOutside(
    panelRef,
    onClose,
    open && !modalOpen,
    `[${SETTINGS_TRIGGER_ATTR}]`
  );

  // Re-render on endpoint change (e.g. from the embedded upstream select)
  // and read the current value straight off `PgSettings`, matching how the
  // rest of the codebase consumes non-React-owned static state.
  useRenderOnChange(PgSettings.onDidChangeConnectionEndpoint);
  const endpoint = PgSettings.connection.endpoint;

  const explorer = useBlockExplorer();
  const wallet = useWallet();
  useProgramInfo();
  const pk = PgProgramInfo.getPkStr();

  // Focus the panel itself on open so keyboard users land somewhere sane
  // without having to guess which control comes first -- unless the caller
  // asked for a specific control, as the cluster row does. On close,
  // restore focus to the element that was active before the panel opened.
  useEffect(() => {
    if (open) {
      if (document.activeElement instanceof HTMLElement) {
        returnFocusTo.current = document.activeElement;
      }
      // Falls back to the first chip when the endpoint is one `NETWORKS` does
      // not list (Playnet, Mainnet Beta, a custom URL).
      const target =
        focus === "network"
          ? chipsRef.current?.querySelector<HTMLElement>(
              '[role="radio"][aria-checked="true"]'
            ) ?? chipsRef.current?.querySelector<HTMLElement>('[role="radio"]')
          : null;
      (target ?? panelRef.current)?.focus();
    } else {
      if (returnFocusTo.current && document.contains(returnFocusTo.current)) {
        returnFocusTo.current.focus();
      }
      returnFocusTo.current = null;
    }
  }, [open, focus]);

  // Close on Escape while open. Scoped to `open` (and skipped while a modal
  // is open, for the same reason as the outside-click guard above) rather
  // than a global keybind, so it never fires while the panel is closed.
  useEffect(() => {
    if (!open || modalOpen) return;

    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, modalOpen, onClose]);

  return (
    <Panel
      ref={panelRef}
      $open={open}
      tabIndex={-1}
      aria-hidden={!open}
      role="region"
      aria-label="Settings"
    >
      <Head>
        <Title>Settings</Title>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close settings"
          onClick={onClose}
        >
          <Close />
        </Button>
      </Head>

      <Section>
        <Eyebrow>Network</Eyebrow>
        <BaseNetworkChoice
          groupRef={chipsRef}
          endpoint={endpoint}
          onPick={(e) => (PgSettings.connection.endpoint = e)}
        />
      </Section>

      <Section>
        <Eyebrow>Project</Eyebrow>
        <Row>
          <AsyncButton
            variant="outline"
            onClick={() => PgFramework.exportWorkspace()}
            onError={reportButtonFailure}
          >
            <ExportFile data-icon="inline-start" />
            Export project (zip)
          </AsyncButton>
        </Row>
        <Row>
          <AsyncButton
            variant="outline"
            size="sm"
            onClick={() => PgView.setModal(ImportGithub)}
            onError={reportButtonFailure}
          >
            <Github data-icon="inline-start" />
            From GitHub
          </AsyncButton>
          <AsyncButton
            variant="outline"
            size="sm"
            onClick={() => PgView.setModal(ImportFs)}
            onError={reportButtonFailure}
          >
            <ImportFile data-icon="inline-start" />
            From files
          </AsyncButton>
        </Row>
      </Section>

      {(wallet || pk) && (
        <Section>
          <Eyebrow>Explorer</Eyebrow>
          <Links>
            {wallet && (
              <Link href={explorer.getAddressUrl(wallet.publicKey.toBase58())}>
                Wallet
              </Link>
            )}
            {pk && <Link href={explorer.getAddressUrl(pk)}>Program</Link>}
            {pk && (
              <Link href={`${explorer.getAddressUrl(pk)}/idl`}>
                Program IDL
              </Link>
            )}
          </Links>
        </Section>
      )}

      <Divider />

      <SettingsFrame>
        <UpstreamSettings />
      </SettingsFrame>
    </Panel>
  );
};

export default GearSidebar;

const Panel = styled.div<{ $open: boolean }>`
  ${({ theme, $open }) => css`
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: 22rem;
    display: flex;
    flex-direction: column;
    background: ${theme.colors.default.bgPrimary};
    border-left: 1px solid ${theme.colors.default.border};
    box-shadow: ${theme.default.boxShadow};
    font-family: ${theme.font.other.family};
    transform: translateX(${$open ? "0" : "100%"});
    visibility: ${$open ? "visible" : "hidden"};
    transition: transform 320ms cubic-bezier(0.2, 0, 0, 1),
      visibility 0s linear ${$open ? "0s" : "320ms"};
    overflow-y: auto;
    z-index: 2;

    &:focus-visible {
      outline: none;
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `}
`;

const Head = styled.div`
  ${({ theme }) => css`
    flex-shrink: 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.875rem 1.25rem;
    border-bottom: 1px solid ${theme.colors.default.border};
  `}
`;

const Title = styled.h2`
  ${({ theme }) => css`
    margin: 0;
    font-size: 0.9375rem;
    font-weight: 600;
    color: ${theme.colors.default.textPrimary};
  `}
`;

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
  padding: 1rem 1.25rem 0;
`;

const Eyebrow = styled.div`
  ${({ theme }) => css`
    font-size: ${theme.font.other.size.xsmall};
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: ${theme.colors.default.primary};
  `}
`;

const Row = styled.div`
  display: flex;
  gap: 0.5rem;
`;

const Links = styled.div`
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  align-items: flex-start;
`;

const Divider = styled.hr`
  ${({ theme }) => css`
    flex-shrink: 0;
    width: 100%;
    height: 1px;
    margin: 1.25rem 0 0;
    border: none;
    background: ${theme.colors.default.border};
  `}
`;

// `UpstreamSettings` (`app/Panels/Side/Left/Settings.tsx`) renders a single
// root `Wrapper` sized and chromed for its original home -- a tooltip-like
// popover anchored to the sidebar. Strip that chrome from the outside so it
// reads as a continuation of this panel instead of a nested card.
// `Settings.tsx` keeps its own `Wrapper`; this only overrides it via
// specificity from a wrapping selector.
const SettingsFrame = styled.div`
  flex: 1;
  min-height: 0;

  > div {
    width: 100%;
    min-width: 0;
    max-width: none;
    min-height: 0;
    max-height: none;
    background: transparent;
    border: none;
    box-shadow: none;
    overflow: visible;
  }
`;
