import { FC, useEffect, useRef, useState } from "react";
import styled, { css } from "styled-components";

import UpstreamSettings from "../../../app/Panels/Side/Left/Settings";
import Button from "../../../components/Button";
import {
  Close,
  ExportFile,
  Github,
  ImportFile,
} from "../../../components/Icons";
import Link from "../../../components/Link";
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
  PgTheme,
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
  // upstream Settings' own "Custom" value modal) render into `ModalBackdrop`
  // -- a sibling of this panel, not a descendant of it, and not one of the
  // portal ids `useOnClickOutside` already excludes. Without this, the very
  // first click inside such a modal (e.g. focusing its input) reads as an
  // "outside" click and slides this panel shut behind the modal's
  // translucent backdrop.
  // Tracks the latest MODAL_SET event, not a modal stack.
  const [modalOpen, setModalOpen] = useState(false);
  useSetStatic(
    PgCommon.getSendAndReceiveEventNames(PgView.events.MODAL_SET).send,
    (detail: { elementable: unknown } | null) =>
      setModalOpen(!!detail?.elementable)
  );

  // The header's toggles are excluded: this hook fires on `mousedown`, so
  // without that a toggle's own `click` would re-open what the `mousedown`
  // just closed -- one render each way, which reads as the panel wiggling.
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
  const activeNetwork = NETWORKS.findIndex((n) => n.endpoint === endpoint);

  const explorer = useBlockExplorer();
  const wallet = useWallet();
  useProgramInfo();
  const pk = PgProgramInfo.getPkStr();

  // Focus the panel itself on open so keyboard users land somewhere sane
  // without having to guess which control comes first -- unless the caller
  // asked for a specific control, as the header's cluster chip does. On close,
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

  // Arrow keys move between clusters, selecting as they go. A radiogroup of
  // `<button>`s gets none of this for free, unlike real radio inputs.
  const moveNetworkFocus = (delta: number) => {
    const chips =
      chipsRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    if (!chips?.length) return;

    const current = Array.from(chips).indexOf(
      document.activeElement as HTMLButtonElement
    );
    const next =
      ((current === -1 ? 0 : current) + delta + chips.length) % chips.length;

    PgSettings.connection.endpoint = NETWORKS[next].endpoint;
    chips[next].focus();
  };

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
        <Button kind="icon" aria-label="Close settings" onClick={onClose}>
          <Close />
        </Button>
      </Head>

      <Section>
        <Eyebrow>Network</Eyebrow>
        <Chips
          ref={chipsRef}
          role="radiogroup"
          aria-label="Network"
          onKeyDown={(ev) => {
            const delta =
              ev.key === "ArrowRight" || ev.key === "ArrowDown"
                ? 1
                : ev.key === "ArrowLeft" || ev.key === "ArrowUp"
                ? -1
                : 0;
            if (!delta) return;
            ev.preventDefault();
            moveNetworkFocus(delta);
          }}
        >
          {NETWORKS.map((n, i) => (
            <Chip
              key={n.endpoint}
              type="button"
              role="radio"
              aria-checked={endpoint === n.endpoint}
              // Roving tabindex: one stop for the whole group. Index 0 takes it
              // when the endpoint is not one of these, so the group stays
              // reachable by Tab.
              tabIndex={
                endpoint === n.endpoint || (activeNetwork === -1 && i === 0)
                  ? 0
                  : -1
              }
              $active={endpoint === n.endpoint}
              onClick={() => (PgSettings.connection.endpoint = n.endpoint)}
            >
              {n.label}
            </Chip>
          ))}
        </Chips>
      </Section>

      <Section>
        <Eyebrow>Project</Eyebrow>
        <Row>
          <Button
            leftIcon={<ExportFile />}
            onClick={() => PgFramework.exportWorkspace()}
          >
            Export project (zip)
          </Button>
        </Row>
        <Row>
          <Button
            kind="outline"
            size="small"
            leftIcon={<Github />}
            onClick={() => PgView.setModal(ImportGithub)}
          >
            From GitHub
          </Button>
          <Button
            kind="outline"
            size="small"
            leftIcon={<ImportFile />}
            onClick={() => PgView.setModal(ImportFs)}
          >
            From files
          </Button>
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
    top: 3.5rem;
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

const Chips = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
`;

const Chip = styled.button<{ $active: boolean }>`
  ${({ theme, $active }) => css`
    padding: 0.375rem 0.875rem;
    border-radius: 999px;
    border: 1px solid
      ${$active ? theme.colors.default.primary : theme.colors.default.border};
    background: ${$active
      ? PgTheme.alpha(theme.colors.default.primary, "medium")
      : "transparent"};
    color: ${$active
      ? theme.colors.default.primary
      : theme.colors.default.textSecondary};
    font-family: ${theme.font.code.family};
    font-size: ${theme.font.code.size.small};
    cursor: pointer;
    transition: color ${theme.default.transition.duration.short}
        ${theme.default.transition.type},
      border-color ${theme.default.transition.duration.short}
        ${theme.default.transition.type},
      background ${theme.default.transition.duration.short}
        ${theme.default.transition.type};

    &:hover {
      color: ${theme.colors.default.primary};
      border-color: ${theme.colors.default.primary};
    }
    &:focus-visible {
      outline: 2px solid ${theme.colors.default.primary};
      outline-offset: 1px;
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
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
// reads as a continuation of this panel instead of a nested card. The
// upstream file itself is untouched; this only overrides via specificity
// from a wrapping selector.
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
