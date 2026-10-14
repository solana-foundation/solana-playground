import type { FC } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import styled, { css } from "styled-components";

import {
  useBalance,
  useConnection,
  useOnClickOutside,
  useRenderOnChange,
  useWallet,
} from "../../../hooks";
import { PgSession } from "../../../features/auth";
import { createLogger } from "../../../shared/lib/logger";
import { PgCommand } from "../../../utils";
import { SETTINGS_TRIGGER_ATTR } from "../settings/GearSidebar";
import type { SettingsFocus } from "../settings/GearSidebar";
import { useClusterStatus } from "./use-cluster-status";

/** Which side of its chip a menu opens on */
type Placement = "below" | "above";

interface StatusChipsProps {
  onToggleSettings: (focus?: SettingsFocus) => void;
  settingsOpen: boolean;
  /**
   * `"above"` at the foot of the navigation, where a menu opening downward
   * would run off the bottom of the window
   */
  placement?: Placement;
}

const shortenPk = (s: string) => `${s.slice(0, 4)}...${s.slice(-4)}`;

const log = createLogger("flow:status-chips");

/** Cluster, wallet + balance and a settings entry point. */
const StatusChips: FC<React.PropsWithChildren<StatusChipsProps>> = ({
  onToggleSettings,
  settingsOpen,
  placement = "below",
}) => {
  const connection = useConnection();
  const wallet = useWallet();
  const balance = useBalance();
  const cluster = useClusterStatus();
  useRenderOnChange(PgSession.onDidChange);
  // Read from the session, not kept here: on a phone these chips sit in the
  // navigation's Sheet, which unmounts them on close while the sign-in goes on
  const signInState = PgSession.signInState();
  const github = PgSession.get();

  const [profileOpen, setProfileOpen] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const profileWrapperRef = useRef<HTMLDivElement>(null);
  const profileChipRef = useRef<HTMLButtonElement>(null);
  const firstMenuRowRef = useRef<HTMLAnchorElement>(null);
  const wasProfileOpenRef = useRef(false);

  const closeProfile = useCallback(() => setProfileOpen(false), []);

  useOnClickOutside(profileWrapperRef, closeProfile, profileOpen);

  useEffect(() => {
    if (!profileOpen) return;

    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") closeProfile();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [profileOpen, closeProfile]);

  useEffect(() => {
    if (profileOpen) {
      wasProfileOpenRef.current = true;
      firstMenuRowRef.current?.focus();
    } else {
      setConfirmingSignOut(false);
      if (wasProfileOpenRef.current) profileChipRef.current?.focus();
      wasProfileOpenRef.current = false;
    }
  }, [profileOpen]);

  const signIn = () => {
    PgSession.signIn().catch((error: unknown) =>
      // `PgSession.signInState` holds the failure and the chips show it from
      // there; telemetry already has its reason
      log.info("sign-in failed", { context: { error: String(error) } })
    );
  };

  return (
    <Wrapper $placement={placement}>
      <ChipButton
        type="button"
        title={connection?.rpcEndpoint}
        aria-label={`Change cluster, currently ${cluster.name}`}
        aria-expanded={settingsOpen}
        {...{ [SETTINGS_TRIGGER_ATTR]: "" }}
        onClick={() => onToggleSettings("network")}
      >
        <ClusterDot $down={cluster.down} />
        {cluster.name}
      </ChipButton>
      <ChipButton
        type="button"
        onClick={() => PgCommand.connect.execute()}
        aria-label={wallet ? "Toggle wallet" : "Connect wallet"}
      >
        {wallet ? (
          <>
            <span>{shortenPk(wallet.publicKey.toBase58())}</span>
            <Balance>
              {typeof balance === "number"
                ? `${balance.toFixed(2)} SOL`
                : "..."}
            </Balance>
          </>
        ) : (
          "Connect wallet"
        )}
      </ChipButton>
      {github ? (
        <ProfileWrapper ref={profileWrapperRef} $placement={placement}>
          <GithubChip
            ref={profileChipRef}
            type="button"
            onClick={() => setProfileOpen((open) => !open)}
            title="GitHub profile"
            aria-expanded={profileOpen}
            aria-label={`GitHub profile: ${
              github.login ?? github.name ?? "account"
            }`}
          >
            <Avatar src={github.image ?? undefined} alt="" aria-hidden />
            <span>{github.login ?? github.name ?? "Account"}</span>
          </GithubChip>
          {profileOpen && (
            <Popover aria-label="GitHub profile" $placement={placement}>
              {confirmingSignOut ? (
                <ConfirmBody>
                  <ConfirmText>Sign out of GitHub?</ConfirmText>
                  <ConfirmActions>
                    <ConfirmSignOutButton
                      type="button"
                      onClick={() => {
                        void PgSession.signOut();
                        closeProfile();
                      }}
                    >
                      Sign out
                    </ConfirmSignOutButton>
                    <CancelButton
                      type="button"
                      onClick={() => setConfirmingSignOut(false)}
                    >
                      Cancel
                    </CancelButton>
                  </ConfirmActions>
                </ConfirmBody>
              ) : (
                <>
                  <ProfileHeader>
                    <ProfileAvatar src={github.image ?? undefined} alt="" />
                    <ProfileNames>
                      <DisplayName>{github.name ?? github.login}</DisplayName>
                      {github.login && <Login>@{github.login}</Login>}
                    </ProfileNames>
                  </ProfileHeader>
                  {github.login && (
                    <>
                      <MenuLink
                        ref={firstMenuRowRef}
                        href={`https://github.com/${github.login}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={closeProfile}
                      >
                        Open GitHub profile
                      </MenuLink>
                      <Separator />
                    </>
                  )}
                  <MenuButtonRow
                    type="button"
                    onClick={() => setConfirmingSignOut(true)}
                  >
                    Sign out
                  </MenuButtonRow>
                </>
              )}
            </Popover>
          )}
        </ProfileWrapper>
      ) : signInState.status === "pending" ? (
        // The popup cannot be asked whether it is still open once GitHub has
        // taken it over, so this is the only way out of the wait short of the
        // ten-minute timeout -- see `popup-channel.ts`.
        <Chip role="status">
          <GithubMark />
          <span>Signing in...</span>
          <CancelSignIn type="button" onClick={PgSession.cancelSignIn}>
            Cancel
          </CancelSignIn>
        </Chip>
      ) : (
        <GithubChip
          ref={profileChipRef}
          type="button"
          onClick={signIn}
          aria-label="Sign in with GitHub"
        >
          <GithubMark />
          <CompactHidden>Sign in</CompactHidden>
        </GithubChip>
      )}
      {signInState.status === "failed" && (
        <AuthError role="alert" title={signInState.message}>
          {signInState.message}
        </AuthError>
      )}
      <IconButton
        aria-label={settingsOpen ? "Close settings" : "Open settings"}
        aria-expanded={settingsOpen}
        {...{ [SETTINGS_TRIGGER_ATTR]: "" }}
        onClick={() => onToggleSettings()}
      >
        <GearIcon />
      </IconButton>
    </Wrapper>
  );
};

export default StatusChips;

// Three slider tracks with knobs -- avoids a hand-authored gear path (a
// version of that broke mid-render because of manual line wrapping).
const GearIcon: FC<React.PropsWithChildren<unknown>> = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
    <g stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
      <line x1="2" y1="3.5" x2="14" y2="3.5" />
      <line x1="2" y1="8" x2="14" y2="8" />
      <line x1="2" y1="12.5" x2="14" y2="12.5" />
    </g>
    <circle cx="10" cy="3.5" r="1.6" fill="currentColor" />
    <circle cx="5" cy="8" r="1.6" fill="currentColor" />
    <circle cx="11" cy="12.5" r="1.6" fill="currentColor" />
  </svg>
);

// Kept as one unbroken path string -- see the note above `GearIcon`
// about manual line wrapping breaking SVG path data mid-render.
const GITHUB_MARK_PATH =
  "M8 .2a8 8 0 0 0-2.5 15.6c.4 0 .5-.2.5-.4v-1.4c-2 .4-2.5-.9-2.5-.9" +
  "-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.9 1.2.9.7 1.2 1.9.9" +
  " 2.4.7 0-.5.3-.9.5-1.1-1.8-.2-3.7-.9-3.7-4a3 3 0 0 1 .8-2.1 2.9" +
  " 2.9 0 0 1 .1-2.1s.7-.2 2.2.8a7.6 7.6 0 0 1 4 0c1.5-1 2.2-.8" +
  " 2.2-.8.3.7.3 1.5.1 2.1a3 3 0 0 1 .8 2.1c0 3.1-1.9 3.8-3.7 4" +
  " .3.3.6.8.6 1.5v2.1c0 .2.1.4.5.4A8 8 0 0 0 8 .2Z";

const GithubMark: FC<React.PropsWithChildren<unknown>> = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden>
    <path fill="currentColor" d={GITHUB_MARK_PATH} />
  </svg>
);

// Above, at the foot of the navigation, the row is the navigation's width
// (`SIDEBAR_STYLE` in `BaseLayoutShell`), narrower than the chips side by
// side, so it wraps, and it is what the profile menu is anchored to (see
// `ProfileWrapper`).
const Wrapper = styled.div<{ $placement: Placement }>`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  ${({ $placement }) =>
    $placement === "above" &&
    css`
      position: relative;
      flex-wrap: wrap;
    `}
`;

// Non-interactive: the "Signing in..." status wraps a live message and its
// own `Cancel` button, so the wrapper itself must not also read as a control.
const Chip = styled.span`
  ${({ theme }) => css`
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.25rem 0.625rem;
    border: 1px solid ${theme.colors.default.border};
    border-radius: 999px;
    font-family: ${theme.font.code.family};
    font-size: ${theme.font.code.size.small};
    color: ${theme.colors.default.textSecondary};
    white-space: nowrap;
  `}
`;

// A chip-shaped `<button>`, used for both the cluster and the wallet. Declared
// as `styled.button` rather than a polymorphic `as="button"` so the native
// button props (`type`, `onClick`) type-check without a fight.
const ChipButton = styled.button`
  ${({ theme }) => css`
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.25rem 0.625rem;
    border: 1px solid ${theme.colors.default.border};
    border-radius: 999px;
    background: transparent;
    color: ${theme.colors.default.textSecondary};
    font-family: ${theme.font.code.family};
    font-size: ${theme.font.code.size.small};
    white-space: nowrap;
    cursor: pointer;
    transition: background 140ms ease, color 140ms ease;

    &:hover {
      background: ${theme.colors.default.bgSecondary};
      color: ${theme.colors.default.textPrimary};
    }
    &:focus-visible {
      outline: 2px solid ${theme.colors.default.primary};
      outline-offset: 2px;
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `}
`;

const GithubChip = styled(ChipButton)``;

const Avatar = styled.img`
  width: 1rem;
  height: 1rem;
  border-radius: 50%;
`;

// Below, anchors the popover under the chip; `position: relative` is the only
// layout role this plays, so it doesn't disturb the flex row it sits in.
// Above, the chip can land anywhere in the wrapped row, and a menu as wide as
// the navigation hung off its right edge would run off the window's left, so
// the menu is anchored to the row (`Wrapper`) instead.
const ProfileWrapper = styled.div<{ $placement: Placement }>`
  position: ${({ $placement }) =>
    $placement === "above" ? "static" : "relative"};
  display: inline-flex;
  align-items: center;
`;

const Popover = styled.div<{ $placement: Placement }>`
  ${({ theme, $placement }) => css`
    position: absolute;
    ${$placement === "above"
      ? "bottom: calc(100% + 0.375rem); left: 0;"
      : "top: calc(100% + 0.375rem); right: 0;"}
    z-index: 5;
    width: 14rem;
    padding: 0.375rem;
    border: 1px solid ${theme.colors.default.border};
    border-radius: ${theme.default.borderRadius};
    background: ${theme.colors.default.bgSecondary};
    box-shadow: ${theme.default.boxShadow};
    font-family: ${theme.font.code.family};
  `}
`;

const ProfileHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
`;

const ProfileAvatar = styled.img`
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  flex-shrink: 0;
`;

const ProfileNames = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
`;

const DisplayName = styled.span`
  ${({ theme }) => css`
    color: ${theme.colors.default.textPrimary};
    font-size: ${theme.font.code.size.small};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `}
`;

const Login = styled.span`
  ${({ theme }) => css`
    color: ${theme.colors.default.textSecondary};
    font-size: ${theme.font.code.size.xsmall};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `}
`;

// Shared look for the popover's interactive rows, applied to both the
// anchor (profile link) and the button (sign out) so neither needs a
// polymorphic `as` prop to type-check.
const menuRowCss = css`
  ${({ theme }) => css`
    display: block;
    width: 100%;
    padding: 0.5rem;
    border: none;
    border-radius: calc(${theme.default.borderRadius} - 2px);
    background: transparent;
    color: ${theme.colors.default.textPrimary};
    font: inherit;
    font-size: ${theme.font.code.size.small};
    text-align: left;
    text-decoration: none;
    cursor: pointer;
    transition: background 140ms ease;

    &:hover {
      background: ${theme.colors.default.bgPrimary};
    }
    &:focus-visible {
      outline: 2px solid ${theme.colors.default.primary};
      outline-offset: -2px;
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `}
`;

const MenuLink = styled.a`
  ${menuRowCss}
`;

const MenuButtonRow = styled.button`
  ${menuRowCss}
`;

const Separator = styled.div`
  height: 1px;
  margin: 0.25rem 0.125rem;
  background: ${({ theme }) => theme.colors.default.border};
`;

const ConfirmBody = styled.div`
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
`;

const ConfirmText = styled.span`
  ${({ theme }) => css`
    color: ${theme.colors.default.textPrimary};
    font-size: ${theme.font.code.size.small};
  `}
`;

const ConfirmActions = styled.div`
  display: flex;
  gap: 0.5rem;
`;

const CancelButton = styled.button`
  ${({ theme }) => css`
    flex: 1;
    padding: 0.375rem 0.625rem;
    border: 1px solid ${theme.colors.default.border};
    border-radius: calc(${theme.default.borderRadius} - 2px);
    background: transparent;
    color: ${theme.colors.default.textPrimary};
    font: inherit;
    font-size: ${theme.font.code.size.small};
    cursor: pointer;
    transition: background 140ms ease;

    &:hover {
      background: ${theme.colors.default.bgPrimary};
    }
    &:focus-visible {
      outline: 2px solid ${theme.colors.default.primary};
      outline-offset: 2px;
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `}
`;

const ConfirmSignOutButton = styled.button`
  ${({ theme }) => css`
    flex: 1;
    padding: 0.375rem 0.625rem;
    border: 1px solid ${theme.colors.state.error.color};
    border-radius: calc(${theme.default.borderRadius} - 2px);
    background: transparent;
    color: ${theme.colors.state.error.color};
    font: inherit;
    font-size: ${theme.font.code.size.small};
    cursor: pointer;
    transition: background 140ms ease;

    &:hover {
      background: ${theme.colors.state.error.bg};
    }
    &:focus-visible {
      outline: 2px solid ${theme.colors.state.error.color};
      outline-offset: 2px;
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `}
`;

const AuthError = styled.span`
  ${({ theme }) => css`
    color: ${theme.colors.state.error.color};
    font-size: ${theme.font.code.size.xsmall};
    white-space: nowrap;
    max-width: 16rem;
    overflow: hidden;
    text-overflow: ellipsis;
  `}
`;

/**
 * Where the chips give way.
 *
 * The chips sit in the navigation's footer, which is the width
 * `SIDEBAR_STYLE` (`BaseLayoutShell`) gives it whatever the window, so a media
 * query on the window says nothing about their room. The breakpoint is a
 * stand-in for the chips' real room until the session footer is rebuilt
 * (HOO-2070): below it the two least load-bearing pieces here, the balance
 * and the "Sign in" wording, drop out.
 * Both remain reachable: the balance in the wallet panel, the wording in the
 * button's `aria-label`.
 */
const CHIPS_COMPACT_AT = "72rem";

const CompactHidden = styled.span`
  @media (max-width: ${CHIPS_COMPACT_AT}) {
    display: none;
  }
`;

const Balance = styled(CompactHidden)`
  color: ${({ theme }) => theme.colors.state.success.color};
`;

const ClusterDot = styled.span<{ $down: boolean }>`
  ${({ theme, $down }) => css`
    width: 0.4rem;
    height: 0.4rem;
    border-radius: 50%;
    background: ${$down
      ? theme.colors.state.error.color
      : theme.colors.state.success.color};
  `}
`;

const IconButton = styled.button`
  ${({ theme }) => css`
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: 1px solid ${theme.colors.default.border};
    border-radius: 50%;
    background: transparent;
    color: ${theme.colors.default.textSecondary};
    cursor: pointer;
    transition: background 140ms ease, color 140ms ease;

    &:hover {
      background: ${theme.colors.default.bgSecondary};
      color: ${theme.colors.default.textPrimary};
    }
    &:focus-visible {
      outline: 2px solid ${theme.colors.default.primary};
      outline-offset: 2px;
    }

    @media (prefers-reduced-motion: reduce) {
      transition: none;
    }
  `}
`;

const CancelSignIn = styled.button`
  ${({ theme }) => css`
    border: none;
    background: transparent;
    padding: 0;
    color: ${theme.colors.default.textSecondary};
    font: inherit;
    font-size: ${theme.font.code.size.small};
    text-decoration: underline;
    cursor: pointer;

    &:hover {
      color: ${theme.colors.default.textPrimary};
    }
  `}
`;
